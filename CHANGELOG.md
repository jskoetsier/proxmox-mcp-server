# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-02-12

### Added
- Initial release of Proxmox MCP Server
- Status monitoring tools:
  - `get_node_status` - Get status of Proxmox nodes
  - `get_storage_status` - Get status of Proxmox storage
  - `get_cluster_status` - Get Proxmox cluster status
  - `get_vm_status` - Get status of Proxmox VMs
  - `get_container_status` - Get status of Proxmox containers
  - `get_running_vms` - Get all running VMs and containers on a node
- VM management tools:
  - `create_vm` - Create a new VM with cloud-init, guest agent, and network interface configuration
  - `delete_vm` - Delete a VM
  - `start_vm` - Start a VM
  - `stop_vm` - Stop a VM
  - `shutdown_vm` - Shutdown a VM gracefully
  - `restart_vm` - Restart a VM
- Container management tools:
  - `create_container` - Create a new container with OS configuration
  - `delete_container` - Delete a container
  - `start_container` - Start a container
  - `stop_container` - Stop a container
  - `shutdown_container` - Shutdown a container gracefully
  - `restart_container` - Restart a container
- Console access:
  - `vm_console` - Access VM console (websocket or serial)
- ISO management:
  - `list_isos` - List ISO files on a Proxmox node
  - `download_iso` - Download an ISO file to a Proxmox node
  - `delete_iso` - Delete an ISO file from a Proxmox node
  - `get_iso_download_status` - Get status of an ISO download task
- Firewall management:
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
- VM guest management (requires Proxmox Guest Agent):
  - `ssh_to_vm` - SSH into a VM using qm console
  - `set_vm_ip` - Set IP address for a VM
  - `set_vm_hostname` - Set hostname for a VM
  - `create_vm_user` - Create a new user in a VM
  - `set_vm_user_password` - Set password for an existing VM user
  - `run_vm_command` - Run a command in a VM
  - `get_vm_interfaces` - Get network interfaces from a VM
- Maintenance:
  - `get_proxmox_version` - Get Proxmox VE version
  - `get_updates` - Get available updates
  - `upgrade_proxmox` - Upgrade Proxmox VE
  - `get_task_status` - Get status of running tasks
