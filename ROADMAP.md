# Roadmap

This document outlines the planned development roadmap for the Proxmox MCP Server.

## v1.0.0 (Current) - Complete

- [x] Basic status monitoring (nodes, storage, clusters, VMs, containers)
- [x] VM lifecycle management (create, delete, start, stop, shutdown, restart)
- [x] Container lifecycle management (create, delete, start, stop, shutdown, restart)
- [x] Console access via qm
- [x] ISO management (download, list, delete)
- [x] Firewall management (enable/disable, rules)
- [x] VM guest management (SSH, IP, hostname, users)
- [x] Proxmox maintenance (version, updates, upgrades)

## v1.1.0 - Complete

### Implemented Features

- [x] Template management
 - `list_templates` - List available templates
 - `create_template_from_vm` - Create a template from a VM
 - `create_template_from_container` - Create a template from a container
 - `delete_template` - Delete a template

- [x] Backup and restore
 - `create_vm_backup` - Create a VM backup
 - `create_container_backup` - Create a container backup
 - `list_backups` - List available backups
 - `restore_vm_backup` - Restore a VM from backup
 - `restore_container_backup` - Restore a container from backup
 - `delete_backup` - Delete a backup

- [x] HA (High Availability) management
 - `enable_vm_ha` - Enable HA for a VM
 - `enable_container_ha` - Enable HA for a container
 - `disable_vm_ha` - Disable HA for a VM
 - `disable_container_ha` - Disable HA for a container
 - `get_ha_status` - Get HA status

- [x] Migration support
 - `migrate_vm` - Migrate a VM to another node
 - `migrate_container` - Migrate a container to another node

- [x] Snapshot management
 - `create_vm_snapshot` - Create a snapshot for a VM
 - `create_container_snapshot` - Create a snapshot for a container
 - `list_vm_snapshots` - List snapshots for a VM
 - `list_container_snapshots` - List snapshots for a container
 - `restore_vm_snapshot` - Restore a VM snapshot
 - `restore_container_snapshot` - Restore a container snapshot
 - `delete_vm_snapshot` - Delete a VM snapshot
 - `delete_container_snapshot` - Delete a container snapshot

- [x] Resource pool management
 - `create_resource_pool` - Create a resource pool
 - `list_resource_pools` - List all resource pools
 - `get_resource_pool_status` - Get status of a resource pool
 - `delete_resource_pool` - Delete a resource pool
 - `add_vm_to_pool` - Add a VM to a resource pool
 - `remove_vm_from_pool` - Remove a VM from a resource pool

### Technical Improvements

- [ ] Add progress tracking for long-running operations
- [ ] Add retry logic for failed API calls
- [ ] Add connection pooling for better performance
- [ ] Add rate limiting support

## v2.0.0 - Future Major Release

### Planned Features

- [ ] Template management
  - `list_templates` - List available templates
  - `create_template` - Create a template from a VM/Container
  - `delete_template` - Delete a template

- [ ] Backup and restore
  - `create_backup` - Create a VM/Container backup
  - `list_backups` - List available backups
  - `restore_backup` - Restore a VM/Container from backup
  - `delete_backup` - Delete a backup

- [ ] HA (High Availability) management
  - `enable_ha` - Enable HA for a VM/Container
  - `disable_ha` - Disable HA for a VM/Container
  - `get_ha_status` - Get HA status

- [ ] Migration support
  - `migrate_vm` - Migrate a VM to another node
  - `migrate_container` - Migrate a container to another node

- [ ] Snapshot management
  - `create_snapshot` - Create a snapshot
  - `list_snapshots` - List snapshots
  - `restore_snapshot` - Restore a snapshot
  - `delete_snapshot` - Delete a snapshot

- [ ] Resource pool management
  - `create_resource_pool` - Create a resource pool
  - `list_resource_pools` - List resource pools
  - `delete_resource_pool` - Delete a resource pool

### Technical Improvements

- [ ] Add progress tracking for long-running operations
- [ ] Add retry logic for failed API calls
- [ ] Add connection pooling for better performance
- [ ] Add rate limiting support

## v2.0.0 - Future Major Release

### Planned Features

- [ ] Multi-cluster support
- [ ] Advanced monitoring and alerting
- [ ] Reporting and analytics
- [ ] API rate limiting and quota management
- [ ] Support for Proxmox Backup Server

### Breaking Changes

- [ ] Update to MCP protocol version 1.0
- [ ] Refactor API for better consistency
