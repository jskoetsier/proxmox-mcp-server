# Proxmox MCP Server

A Model Context Protocol (MCP) server for managing Proxmox VE (Virtual Environment).

## Features

- **Status Monitoring**: Get status of nodes, storage, clusters, VMs, and containers
- **VM Management**: Create, delete, start, stop, shutdown, restart VMs
- **Container Management**: Create, delete, start, stop, shutdown, restart containers
- **Console Access**: Access VM console via websocket or serial
- **Maintenance**: Get Proxmox version, check for updates, perform upgrades

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
- `get_storage_status` - Get status of Proxmox storage
- `get_cluster_status` - Get Proxmox cluster status
- `get_vm_status` - Get status of Proxmox VMs
- `get_container_status` - Get status of Proxmox containers
- `get_running_vms` - Get all running VMs and containers on a node

### VM Management
- `create_vm` - Create a new VM with OS configuration
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

### Maintenance
- `get_proxmox_version` - Get Proxmox VE version
- `get_updates` - Get available updates
- `upgrade_proxmox` - Upgrade Proxmox VE
- `get_task_status` - Get status of running tasks

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