import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";

const config = new pulumi.Config();
const project = config.require("project");
const region = config.get("region") || "us-central1";
const zone = config.get("zone") || "us-central1-a";
const machineType = config.get("machineType") || "n1-standard-4";
const gpuType = config.get("gpuType") || "nvidia-tesla-t4";
const gpuCount = config.getNumber("gpuCount") || 0; // 0 = no GPU

// VPC Network
const network = new gcp.compute.Network("voice-clone-network", {
    autoCreateSubnetworks: true,
});

// Firewall rules
const firewall = new gcp.compute.Firewall("voice-clone-firewall", {
    network: network.id,
    allows: [
        { protocol: "tcp", ports: ["22", "3000"] },
        { protocol: "icmp" },
    ],
    sourceRanges: ["0.0.0.0/0"],
    targetTags: ["voice-clone-api"],
});

// Static IP
const staticIp = new gcp.compute.Address("voice-clone-ip", {
    region: region,
});

// Startup script
const startupScript = `#!/bin/bash
set -e
exec > >(tee /var/log/startup.log) 2>&1

apt-get update
apt-get install -y python3 python3-pip python3-venv ffmpeg git wget curl

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# Clone and setup API
cd /opt
git clone https://github.com/ybouhjira/voice-clone-api.git
cd voice-clone-api

# Clone RVC
git clone https://github.com/RVC-Project/Retrieval-based-Voice-Conversion-WebUI.git rvc
cd rvc && pip3 install -r requirements.txt && cd ..

# Download pretrained models
mkdir -p rvc/assets/pretrained_v2
wget -q https://huggingface.co/lj1995/VoicConversionWebUI/resolve/main/pretrained_v2/f0G40k.pth -O rvc/assets/pretrained_v2/f0G40k.pth
wget -q https://huggingface.co/lj1995/VoicConversionWebUI/resolve/main/pretrained_v2/f0D40k.pth -O rvc/assets/pretrained_v2/f0D40k.pth

# Build API
npm install && npm run build

# Create systemd service
cat > /etc/systemd/system/voice-clone-api.service << 'EOF'
[Unit]
Description=Voice Clone API
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/voice-clone-api
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=RVC_DIR=/opt/voice-clone-api/rvc
Environment=MODELS_DIR=/opt/voice-clone-api/models
ExecStart=/usr/bin/node dist/index.js
Restart=always

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable voice-clone-api
systemctl start voice-clone-api
`;

// VM Instance (GPU optional)
const instance = new gcp.compute.Instance("voice-clone-vm", {
    machineType: machineType,
    zone: zone,
    tags: ["voice-clone-api"],

    bootDisk: {
        initializeParams: {
            image: "ubuntu-os-cloud/ubuntu-2204-lts",
            size: 50,
            type: "pd-standard",
        },
    },

    guestAccelerators: gpuCount > 0 ? [{
        type: pulumi.interpolate`projects/${project}/zones/${zone}/acceleratorTypes/${gpuType}`,
        count: gpuCount,
    }] : undefined,

    scheduling: {
        onHostMaintenance: gpuCount > 0 ? "TERMINATE" : "MIGRATE",
        automaticRestart: true,
    },

    networkInterfaces: [{
        network: network.id,
        accessConfigs: [{
            natIp: staticIp.address,
        }],
    }],

    metadataStartupScript: startupScript,

    serviceAccount: {
        scopes: ["cloud-platform"],
    },
});

export const instanceName = instance.name;
export const publicIp = staticIp.address;
export const apiUrl = pulumi.interpolate`http://${staticIp.address}:3000`;
export const sshCommand = pulumi.interpolate`gcloud compute ssh ${instance.name} --zone=${zone}`;
