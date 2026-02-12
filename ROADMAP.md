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

## v1.1.0 - Future Enhancements

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
