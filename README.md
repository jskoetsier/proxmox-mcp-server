# Proxmox MCP Server

A Model Context Protocol (MCP) server for managing Proxmox VE (Virtual Environment).

## Features

- **Status Monitoring**: Get status of nodes, storage, clusters, VMs, and containers
- **VM Management**: Create, delete, start, stop, shutdown, restart VMs
- **Container Management**: Create, delete, start, stop, shutdown, restart containers
- **Console Access**: Access VM console via websocket or serial
- **ISO Management**: Download, list, and manage ISO files
- **VM Guest Management**: SSH, set IPs, manage users (requires Proxmox guest agent)
- **Maintenance**: Get Proxmox version, check for updates, perform upgrades
- **Template Management**: Create and manage VM/container templates
- **Backup and Restore**: Create and restore backups for VMs and containers
- **HA Management**: Enable/disable High Availability for VMs and containers
- **Migration**: Migrate VMs and containers between nodes
- **Snapshots**: Create and manage VM/container snapshots
- **Resource Pools**: Manage resource pools and assign VMs to them

## n8n Compatibility

This server supports both **stdio** and **HTTP** transports, making it compatible with n8n and other MCP clients.

### HTTP Transport Mode (for n8n)

To use with n8n, set the `HTTP_MODE` environment variable to `"true"`:

```json
{
  "mcpServers": {
    "proxmox": {
      "command": "node",
      "args": ["/path/to/proxmox-mcp-server/build/index.js"],
      "env": {
        "PROXMOX_HOST": "YOUR_PROXMOX_HOSTNAME_OR_IP",
        "PROXMOX_USER": "YOUR_USERNAME@pam",
        "PROXMOX_PASSWORD": "YOUR_PASSWORD",
        "HTTP_MODE": "true",
        "HTTP_PORT": "3333"
      }
    }
  }
}
```

n8n will connect to `http://localhost:3333/` for MCP communication.

## Prerequisites

- Node.js 18 or higher
- Proxmox VE 7.x or higher
- An account with appropriate permissions (e.g., `PVEAuditor` or `PVEAdmin` role)

## Installation

### 1. Clone or navigate to the server directory

```bash
cd proxmox-mcp-server
```

### 2. Install dependencies

```bash
npm install
```

### 3. Build the server

```bash
npm run build
```

### 4. Configure environment variables

The server requires the following environment variables:

| Variable | Description | Example |
|----------|-------------|---------|
| `PROXMOX_HOST` | Proxmox hostname or IP address | `proxmox.example.com` or `192.168.1.100` |
| `PROXMOX_USER` | Proxmox username with full path | `admin@pam` or `user@pve` |
| `PROXMOX_PASSWORD` | Proxmox password | `your_password` |
| `PROXMOX_PORT` | (Optional) Proxmox API port (default: 8006) | `8006` |
| `PROXMOX_VERIFY_SSL` | (Optional) Verify SSL certificate (default: true) | `true` or `false` |

### 5. Configure MCP settings

Add the server configuration to your MCP settings file:

**For Roo Code (macOS/Linux):** `~/.roo-code/settings/mcp_settings.json`

**For Roo Code (Windows):** `%APPDATA%\roo-code\settings\mcp_settings.json`

**For Claude Desktop (macOS):** `~/Library/Application Support/Claude/claude_desktop_config.json`

**For Claude Desktop (Windows):** `%APPDATA%\Claude\claude_desktop_config.json`

Example configuration:

```json
{
  "mcpServers": {
    "proxmox": {
      "command": "node",
      "args": ["/path/to/proxmox-mcp-server/build/index.js"],
      "env": {
        "PROXMOX_HOST": "proxmox.example.com",
        "PROXMOX_USER": "admin@pam",
        "PROXMOX_PASSWORD": "your_password"
      },
      "disabled": false,
      "alwaysAllow": [],
      "disabledTools": []
    }
  }
}
```

### 6. Restart your MCP client

Restart Roo Code or Claude Desktop to load the new MCP server configuration.

## Usage

Once configured, you can use the Proxmox MCP server through your MCP client's interface. Available tools include:

### Status Tools
- `get_node_status` - Get status of Proxmox nodes
- `get_summary` - Get summary of Proxmox node resources
- `get_storage_status` - Get status of Proxmox storage
- `get_cluster_status` - Get Proxmox cluster status
- `get_vm_status` - Get status of Proxmox VMs
- `get_container_status` - Get status of Proxmox containers
- `get_running_vms` - Get all running VMs and containers on a node

### VM Management
- `create_vm` - Create a new VM with cloud-init, guest agent, and network interface configuration
- `delete_vm` - Delete a VM
- `start_vm` - Start a VM
- `stop_vm` - Stop a VM
- `shutdown_vm` - Shutdown a VM gracefully
- `restart_vm` - Restart a VM

### Container Management
- `create_container` - Create a new container with OS configuration
- `delete_container` - Delete a container
- `start_container` - Start a container
- `stop_container` - Stop a container
- `shutdown_container` - Shutdown a container gracefully
- `restart_container` - Restart a container

### Console Access
- `vm_console` - Access VM console (websocket or serial)

### ISO Management
- `list_isos` - List ISO files on a Proxmox node
- `download_iso` - Download an ISO file to a Proxmox node
- `delete_iso` - Delete an ISO file from a Proxmox node
- `get_iso_download_status` - Get status of an ISO download task

### Firewall Management
- `enable_vm_firewall` - Enable firewall for a VM
- `disable_vm_firewall` - Disable firewall for a VM
- `enable_container_firewall` - Enable firewall for a container
- `disable_container_firewall` - Disable firewall for a container
- `create_vm_firewall_rule` - Create a firewall rule for a VM
- `create_container_firewall_rule` - Create a firewall rule for a container
- `list_vm_firewall_rules` - List firewall rules for a VM
- `list_container_firewall_rules` - List firewall rules for a container
- `delete_vm_firewall_rule` - Delete a firewall rule for a VM
- `delete_container_firewall_rule` - Delete a firewall rule for a container

### VM Guest Management (requires Proxmox Guest Agent)
- `ssh_to_vm` - SSH into a VM using qm console
- `set_vm_ip` - Set IP address for a VM
- `set_vm_hostname` - Set hostname for a VM
- `create_vm_user` - Create a new user in a VM
- `set_vm_user_password` - Set password for an existing VM user
- `run_vm_command` - Run a command in a VM
- `get_vm_interfaces` - Get network interfaces from a VM

### Maintenance
- `get_proxmox_version` - Get Proxmox VE version
- `get_updates` - Get available updates
- `upgrade_proxmox` - Upgrade Proxmox VE
- `get_task_status` - Get status of running tasks

### Prerequisites for VM Guest Management

The `create_vm` tool enables the Proxmox Guest Agent when `installGuestAgent` is enabled (default: true). However, you still need to install the guest agent inside the VM:

1. Install the Proxmox Guest Agent inside your VMs/containers
2. For Linux VMs: `apt install qemu-guest-agent` or `yum install qemu-guest-agent`
3. Ensure the guest agent service is running: `systemctl enable --now qemu-guest-agent`

Note: The VM is created in a stopped state. You need to start it manually after creation.

### Network Interface Configuration

The `create_vm` tool supports multiple network interfaces with various configuration options:

| Parameter | Description | Example |
|-----------|-------------|---------|
| `net0` | Network interface 0 | `virtio=00:11:22:33:44:55,bridge=vmbr0` |
| `net1` | Network interface 1 | `e1000=00:11:22:33:44:56,bridge=vmbr1` |
| `net2` | Network interface 2 | `rtl8139=00:11:22:33:44:57,bridge=vmbr2` |
| `net3` | Network interface 3 | `virtio=00:11:22:33:44:58,bridge=vmbr3` |

**Network interface format:** `type=MAC_ADDRESS,bridge=BRIDGE_NAME`

Supported NIC types: `virtio`, `e1000`, `rtl8139`, `vmxnet3`, `ne2k_pci`, `pcnet`

### Cloud-init Configuration

The `create_vm` tool supports cloud-init for automated VM configuration:

| Parameter | Description | Example |
|-----------|-------------|---------|
| `cloudinit` | Enable cloud-init (default: true) | `true` |
| `nameserver` | DNS nameserver | `8.8.8.8` |
| `searchdomain` | Search domain | `example.com` |
| `ipconfig` | IP configuration | `ip=192.168.1.100/24,gw=192.168.1.1` |
| `sshkeys` | SSH public keys | `ssh-rsa AAAA...` |
| `user` | Username for cloud-init | `ubuntu` |
| `password` | Password for cloud-init user | `your_password` |

### ISO Management

To install an OS from an ISO file:

1. **Download the ISO**:
```json
{
  "method": "proxmox/download_iso",
  "params": {
    "node": "pve1",
    "storage": "local",
    "filename": "ubuntu-22.04.iso",
    "url": "https://releases.ubuntu.com/22.04/ubuntu-22.04.4-live-server-amd64.iso"
  }
}
```

2. **List ISOs** to verify the download:
```json
{
  "method": "proxmox/list_isos",
  "params": {
    "node": "pve1",
    "storage": "local"
  }
}
```

3. **Create a VM** with the ISO as the boot device:
```json
{
  "method": "proxmox/create_vm",
  "params": {
    "node": "pve1",
    "vmid": 100,
    "name": "ubuntu-server",
    "memory": 2048,
    "cores": 2,
    "disk": "virtio0: local:20",
    "ostype": "l26",
    "scsihw": "virtio-scsi-pci",
    "bootdisk": "virtio0",
    "net0": "virtio,bridge=vmbr0"
  }
}
```

4. **Attach the ISO** to the VM (after creation):
```json
{
  "method": "proxmox/create_vm",
  "params": {
    "node": "pve1",
    "vmid": 100,
    "name": "ubuntu-server",
    "memory": 2048,
    "cores": 2,
    "disk": "virtio0: local:20",
    "ostype": "l26",
    "scsihw": "virtio-scsi-pci",
    "bootdisk": "virtio0",
    "net0": "virtio,bridge=vmbr0",
    "ide2": "local:iso/ubuntu-22.04.iso,media=cdrom"
  }
}
```

### Firewall Management

**Enable firewall for a VM:**
```json
{
  "method": "proxmox/enable_vm_firewall",
  "params": {
    "node": "pve1",
    "vmid": 100
  }
}
```

**Create a firewall rule:**
```json
{
  "method": "proxmox/create_vm_firewall_rule",
  "params": {
    "node": "pve1",
    "vmid": 100,
    "rule": "in,REJECT,22/tcp",
    "pos": 1
  }
}
```

**List firewall rules:**
```json
{
  "method": "proxmox/list_vm_firewall_rules",
  "params": {
    "node": "pve1",
    "vmid": 100
  }
}
```

## Development

### Build

```bash
npm run build
```

### Run directly (for testing)

```bash
PROXMOX_HOST=your-host PROXMOX_USER=your-user PROXMOX_PASSWORD=your-password npm start
```

## License

MIT