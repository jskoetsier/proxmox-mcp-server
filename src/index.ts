#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import axios, { AxiosError } from "axios";

// Environment variables for Proxmox configuration
const PROXMOX_HOST = process.env.PROXMOX_HOST;
const PROXMOX_USER = process.env.PROXMOX_USER;
const PROXMOX_PASSWORD = process.env.PROXMOX_PASSWORD;
const PROXMOX_PORT = process.env.PROXMOX_PORT || "8006";
const PROXMOX_VERIFY_SSL = process.env.PROXMOX_VERIFY_SSL !== "false";

if (!PROXMOX_HOST || !PROXMOX_USER || !PROXMOX_PASSWORD) {
  throw new Error(
    "PROXMOX_HOST, PROXMOX_USER, and PROXMOX_PASSWORD environment variables are required"
  );
}

// Proxmox API base URL
const API_BASE = `https://${PROXMOX_HOST}:${PROXMOX_PORT}/api2/json`;

// Type definitions for Proxmox API responses
interface ProxmoxResponse<T> {
  data?: T;
  errors?: string[];
}

interface Ticket {
  ticket: string;
  CSRFPreventionToken: string;
}

interface NodeStatus {
  node: string;
  type: string;
  level: string;
  cpu: number;
  memory: {
    used: number;
    free: number;
    total: number;
    max: number;
  };
  swap: {
    used: number;
    free: number;
    total: number;
  };
  uptime: number;
  load: number[];
  disk: number;
  maxdisk: number;
  running: number;
  maxcpu: number;
  maxmem: number;
  version: string;
  uptime_seconds: number;
}

interface StorageStatus {
  storage: string;
  type: string;
  disk: number;
  maxdisk: number;
  used: number;
  avail: number;
  enabled: number;
  shared: number;
  content: string;
  node: string;
  maxmem: number;
  mem: number;
  cpu: number;
  maxcpu: number;
  load: number[];
  uptime: number;
  running: number;
  template: number;
  status: string;
}

interface ClusterStatus {
  name: string;
  size: number;
  quorate: number;
  nodeid: number;
  has_quorum: boolean;
  num_nodes: number;
  multi_factor_auth: {
    enabled: boolean;
    required: boolean;
  };
  databases: {
    [key: string]: {
      local: number;
      remote: number;
      total: number;
    };
  };
  databases_total: number;
  db_version: number;
  databases_local: number;
  databases_remote: number;
  db_version_local: number;
  db_version_remote: number;
  nodes: {
    [key: string]: {
      nodeid: number;
      name: string;
      ip: string;
      version: number;
      quorum: number;
    };
  };
}

interface VMStatus {
  vmid: number;
  type: string;
  name: string;
  status: string;
  cpu: number;
  maxcpu: number;
  mem: number;
  maxmem: number;
  maxdisk: number;
  disk: number;
  uptime: number;
  diskread: number;
  diskwrite: number;
  netin: number;
  netout: number;
  bootdisk: number;
  pid: string;
  qmpstatus: string;
  balloon: number;
  balloon_min: number;
  balloon_max: number;
  threads: number;
  cores: number;
  sockets: number;
  vcpus: number;
  diskread_iops: number;
  diskwrite_iops: number;
  netin_iops: number;
  netout_iops: number;
}

interface ContainerStatus {
  vmid: number;
  type: string;
  name: string;
  status: string;
  cpu: number;
  maxcpu: number;
  mem: number;
  maxmem: number;
  maxdisk: number;
  disk: number;
  uptime: number;
  diskread: number;
  diskwrite: number;
  netin: number;
  netout: number;
  bootdisk: number;
  pid: string;
  balloon: number;
  balloon_min: number;
  balloon_max: number;
  threads: number;
  cores: number;
  sockets: number;
  vcpus: number;
  diskread_iops: number;
  diskwrite_iops: number;
  netin_iops: number;
  netout_iops: number;
  netmask: string;
  gateway: string;
}

interface TaskStatus {
  id: string;
  type: string;
  status: string;
  user: string;
  starttime: number;
  upid: string;
  node: string;
  pstart: number;
  state: string;
  exitstatus: string;
  text: string;
  progress: number;
}

// Create MCP server
const server = new McpServer(
  {
    name: "proxmox-mcp-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Helper function to get authentication ticket
async function getTicket(): Promise<Ticket> {
  try {
    const response = await axios.post<ProxmoxResponse<Ticket>>(
      `${API_BASE}/access/ticket`,
      {
        username: PROXMOX_USER,
        password: PROXMOX_PASSWORD,
      },
      {
        validateStatus: () => true,
        httpsAgent: PROXMOX_VERIFY_SSL
          ? undefined
          : new (require("https").Agent)({ rejectUnauthorized: false }),
      }
    );

    if (response.data?.data) {
      return response.data.data;
    }
    throw new Error("Failed to get authentication ticket");
  } catch (error) {
    throw new Error(`Authentication failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// Helper function to make authenticated requests
async function makeRequest<T>(
  method: "get" | "post" | "put" | "delete",
  endpoint: string,
  data?: any
): Promise<T> {
  const ticket = await getTicket();
  
  const config = {
    headers: {
      "Cookie": `PVEAuthCookie=${ticket.ticket}`,
      "CSRFPreventionToken": ticket.CSRFPreventionToken,
    },
    httpsAgent: PROXMOX_VERIFY_SSL
      ? undefined
      : new (require("https").Agent)({ rejectUnauthorized: false }),
  };

  try {
    const response = await axios.request<ProxmoxResponse<T>>({
      method,
      url: `${API_BASE}${endpoint}`,
      data,
      ...config,
      validateStatus: () => true,
    });

    if (response.data?.data !== undefined) {
      return response.data.data;
    }
    
    throw new Error(
      response.data?.errors?.[0] ||
        `Request failed with status ${response.status}`
    );
  } catch (error) {
    const axiosError = error as AxiosError;
    const errors = axiosError.response?.data as { errors?: string[] } | undefined;
    throw new Error(
      `Proxmox API error: ${errors?.errors?.[0] || axiosError.message}`
    );
  }
}

// ==================== Status Tools ====================

// Get node status
server.registerTool(
  "get_node_status",
  {
    description: "Get status of Proxmox nodes",
    inputSchema: {
      node: z.string().optional().describe("Node name (optional, defaults to all nodes)"),
    },
  },
  async ({ node }) => {
    try {
      const endpoint = node ? `/nodes/${node}/status` : "/nodes";
      const status = await makeRequest<NodeStatus | NodeStatus[]>("get", endpoint);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(status, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error getting node status: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Get storage status
server.registerTool(
  "get_storage_status",
  {
    description: "Get status of Proxmox storage",
    inputSchema: {
      node: z.string().optional().describe("Node name (optional)"),
      storage: z.string().optional().describe("Storage name (optional)"),
    },
  },
  async ({ node, storage }) => {
    try {
      let endpoint = "/storage";
      if (node) {
        endpoint = node ? `/nodes/${node}/storage` : "/storage";
      }
      if (storage) {
        endpoint = node ? `/nodes/${node}/storage/${storage}/status` : `/storage/${storage}/status`;
      }
      const status = await makeRequest<StorageStatus | StorageStatus[]>("get", endpoint);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(status, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error getting storage status: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Get cluster status
server.registerTool(
  "get_cluster_status",
  {
    description: "Get Proxmox cluster status",
  },
  async () => {
    try {
      const status = await makeRequest<ClusterStatus>("get", "/cluster/status");
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(status, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error getting cluster status: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Get VM status
server.registerTool(
  "get_vm_status",
  {
    description: "Get status of Proxmox VMs",
    inputSchema: {
      node: z.string().optional().describe("Node name (optional)"),
      vmid: z.number().optional().describe("VM ID (optional)"),
    },
  },
  async ({ node, vmid }) => {
    try {
      let endpoint = "/qemu";
      if (node) {
        endpoint = `/nodes/${node}/qemu`;
      }
      if (vmid) {
        endpoint = node ? `/nodes/${node}/qemu/${vmid}` : `/qemu/${vmid}`;
      }
      const status = await makeRequest<VMStatus | VMStatus[]>("get", endpoint);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(status, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error getting VM status: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Get container status
server.registerTool(
  "get_container_status",
  {
    description: "Get status of Proxmox containers",
    inputSchema: {
      node: z.string().optional().describe("Node name (optional)"),
      vmid: z.number().optional().describe("Container ID (optional)"),
    },
  },
  async ({ node, vmid }) => {
    try {
      let endpoint = "/lxc";
      if (node) {
        endpoint = `/nodes/${node}/lxc`;
      }
      if (vmid) {
        endpoint = node ? `/nodes/${node}/lxc/${vmid}` : `/lxc/${vmid}`;
      }
      const status = await makeRequest<ContainerStatus | ContainerStatus[]>("get", endpoint);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(status, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error getting container status: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ==================== Creation Tools ====================

// Create VM
server.registerTool(
  "create_vm",
  {
    description: "Create a new VM on Proxmox with optional cloud-init configuration",
    inputSchema: {
      node: z.string().describe("Node to create VM on"),
      vmid: z.number().describe("VM ID (unique, 100-999999999)"),
      name: z.string().optional().describe("VM name"),
      cores: z.number().min(1).max(128).optional().describe("Number of CPU cores"),
      sockets: z.number().min(1).max(16).optional().describe("Number of CPU sockets"),
      memory: z.number().min(16).describe("Memory in MB"),
      // Network interface configuration
      net0: z.string().optional().describe("Network interface 0 (e.g., 'virtio=00:11:22:33:44:55,bridge=vmbr0')"),
      net1: z.string().optional().describe("Network interface 1"),
      net2: z.string().optional().describe("Network interface 2"),
      net3: z.string().optional().describe("Network interface 3"),
      // Disk configuration
      disk: z.string().optional().describe("Disk configuration (e.g., 'virtio0: local-lvm:20')"),
      ide0: z.string().optional().describe("IDE device 0 (e.g., 'local:iso/ubuntu-22.04.iso,media=cdrom')"),
      ide1: z.string().optional().describe("IDE device 1"),
      ide2: z.string().optional().describe("IDE device 2"),
      ide3: z.string().optional().describe("IDE device 3"),
      sata0: z.string().optional().describe("SATA device 0"),
      sata1: z.string().optional().describe("SATA device 1"),
      scsi0: z.string().optional().describe("SCSI device 0"),
      scsi1: z.string().optional().describe("SCSI device 1"),
      scsi2: z.string().optional().describe("SCSI device 2"),
      scsi3: z.string().optional().describe("SCSI device 3"),
      scsihw: z.string().optional().describe("SCSI controller (e.g., 'virtio-scsi-pci')"),
      bootdisk: z.string().optional().describe("Boot disk (e.g., 'virtio0')"),
      boot: z.string().optional().describe("Boot order (e.g., 'cdn')"),
      // OS configuration
      ostype: z.string().optional().describe("OS type (e.g., 'l26', 'windows', 'macos')"),
      onboot: z.boolean().optional().describe("Start VM on boot"),
      desc: z.string().optional().describe("Description"),
      // Cloud-init options
      cloudinit: z.boolean().optional().describe("Enable cloud-init (default: true)"),
      nameserver: z.string().optional().describe("DNS nameserver for cloud-init"),
      searchdomain: z.string().optional().describe("Search domain for cloud-init"),
      ipconfig: z.string().optional().describe("IP configuration for cloud-init (e.g., 'ip=192.168.1.100/24,gw=192.168.1.1')"),
      sshkeys: z.string().optional().describe("SSH public keys for cloud-init"),
      user: z.string().optional().describe("Username for cloud-init (default: 'ubuntu')"),
      password: z.string().optional().describe("Password for cloud-init user"),
      // Guest agent options
      installGuestAgent: z.boolean().optional().describe("Install and enable Proxmox Guest Agent (default: true)"),
    },
  },
  async ({ node, vmid, name, cores, sockets, memory, net0, net1, net2, net3, disk, ide0, ide1, ide2, ide3, sata0, sata1, scsi0, scsi1, scsi2, scsi3, scsihw, bootdisk, boot, ostype, onboot, desc, cloudinit, nameserver, searchdomain, ipconfig, sshkeys, user, password, installGuestAgent }) => {
    try {
      const params: Record<string, any> = { vmid, memory };
      
      if (name) params.name = name;
      if (cores) params.cores = cores;
      if (sockets) params.sockets = sockets;
      if (net0) params.net0 = net0;
      if (net1) params.net1 = net1;
      if (net2) params.net2 = net2;
      if (net3) params.net3 = net3;
      if (disk) params.disk = disk;
      if (ide0) params.ide0 = ide0;
      if (ide1) params.ide1 = ide1;
      if (ide2) params.ide2 = ide2;
      if (ide3) params.ide3 = ide3;
      if (sata0) params.sata0 = sata0;
      if (sata1) params.sata1 = sata1;
      if (scsi0) params.scsi0 = scsi0;
      if (scsi1) params.scsi1 = scsi1;
      if (scsi2) params.scsi2 = scsi2;
      if (scsi3) params.scsi3 = scsi3;
      if (scsihw) params.scsihw = scsihw;
      if (bootdisk) params.bootdisk = bootdisk;
      if (boot) params.boot = boot;
      if (ostype) params.ostype = ostype;
      if (onboot !== undefined) params.onboot = onboot ? "1" : "0";
      if (desc) params.desc = desc;
      
      // Cloud-init configuration
      if (cloudinit !== false) {
        if (nameserver) params.nameserver = nameserver;
        if (searchdomain) params.searchdomain = searchdomain;
        if (ipconfig) params.ipconfig0 = ipconfig;
        if (sshkeys) params.sshkeys = sshkeys;
        if (user) params.user = user;
        if (password) params.password = password;
      } else {
        params.cloudinit = "0";
      }
      
      // Guest agent configuration
      if (installGuestAgent !== false) {
        // Install qemu-guest-agent package
        params.agent = "1";
      }

      const result = await makeRequest<{ vmid: number }>("post", `/nodes/${node}/qemu`, params);
      
      // If guest agent is enabled, install and configure it
      if (installGuestAgent !== false) {
        // Wait a moment for VM to start
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Start the VM if not already running
        try {
          await makeRequest<void>("post", `/nodes/${node}/qemu/${vmid}/status/start`);
        } catch (startError) {
          // VM might already be running
        }
        
        // Install qemu-guest-agent via cloud-init or run command
        try {
          // Try to run command via guest agent
          const installCmd = "apt-get update && apt-get install -y qemu-guest-agent && systemctl enable --now qemu-guest-agent";
          await makeRequest<{ data: any }>("post", `/nodes/${node}/qemu/${vmid}/agent/exec`, {
            command: installCmd,
          });
        } catch (installError) {
          // Guest agent might not be available yet, skip silently
        }
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ success: true, vmid: result.vmid }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error creating VM: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Create Container
server.registerTool(
  "create_container",
  {
    description: "Create a new container on Proxmox",
    inputSchema: {
      node: z.string().describe("Node to create container on"),
      vmid: z.number().describe("Container ID (unique, 100-999999999)"),
      hostname: z.string().describe("Container hostname"),
      ostemplate: z.string().describe("OS template (e.g., 'local:vztmpl/ubuntu-22.04-standard_22.04-1_amd64.tar.zst')"),
      cores: z.number().min(1).max(128).optional().describe("Number of CPU cores"),
      memory: z.number().min(16).describe("Memory in MB"),
      swap: z.number().min(0).optional().describe("Swap in MB"),
      net0: z.string().optional().describe("Network interface configuration"),
      ipaddr: z.string().optional().describe("IP address"),
      gateway: z.string().optional().describe("Gateway"),
      password: z.string().optional().describe("Root password"),
      nameserver: z.string().optional().describe("DNS server"),
      ssh_public_keys: z.string().optional().describe("SSH public keys"),
      unprivileged: z.boolean().optional().describe("Unprivileged container"),
      description: z.string().optional().describe("Description"),
    },
  },
  async ({ node, vmid, hostname, ostemplate, cores, memory, swap, net0, ipaddr, gateway, password, nameserver, ssh_public_keys, unprivileged, description }) => {
    try {
      const params: Record<string, any> = { vmid, hostname, ostemplate, memory };
      
      if (cores) params.cores = cores;
      if (swap) params.swap = swap;
      if (net0) params.net0 = net0;
      if (ipaddr) params.ipaddr = ipaddr;
      if (gateway) params.gateway = gateway;
      if (password) params.password = password;
      if (nameserver) params.nameserver = nameserver;
      if (ssh_public_keys) params.ssh_public_keys = ssh_public_keys;
      if (unprivileged !== undefined) params.unprivileged = unprivileged ? "1" : "0";
      if (description) params.description = description;

      const result = await makeRequest<{ vmid: number }>("post", `/nodes/${node}/lxc`, params);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ success: true, vmid: result.vmid }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error creating container: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ==================== Deletion Tools ====================

// Delete VM
server.registerTool(
  "delete_vm",
  {
    description: "Delete a VM from Proxmox",
    inputSchema: {
      node: z.string().describe("Node where VM is located"),
      vmid: z.number().describe("VM ID to delete"),
      force: z.boolean().optional().describe("Force delete (removes VM even if in use)"),
    },
  },
  async ({ node, vmid, force }) => {
    try {
      const params: Record<string, any> = {};
      if (force) params.force = "1";

      await makeRequest<void>("delete", `/nodes/${node}/qemu/${vmid}`, params);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ success: true, message: `VM ${vmid} deleted successfully` }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error deleting VM: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Delete Container
server.registerTool(
  "delete_container",
  {
    description: "Delete a container from Proxmox",
    inputSchema: {
      node: z.string().describe("Node where container is located"),
      vmid: z.number().describe("Container ID to delete"),
      force: z.boolean().optional().describe("Force delete"),
    },
  },
  async ({ node, vmid, force }) => {
    try {
      const params: Record<string, any> = {};
      if (force) params.force = "1";

      await makeRequest<void>("delete", `/nodes/${node}/lxc/${vmid}`, params);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ success: true, message: `Container ${vmid} deleted successfully` }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error deleting container: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ==================== Console Access Tool ====================

// Access VM console
server.registerTool(
  "vm_console",
  {
    description: "Access VM console",
    inputSchema: {
      node: z.string().describe("Node where VM is located"),
      vmid: z.number().describe("VM ID"),
      type: z.enum(["serial", "websocket"]).optional().describe("Console type"),
    },
  },
  async ({ node, vmid, type = "websocket" }) => {
    try {
      const result = await makeRequest<{ data: any }>("post", `/nodes/${node}/qemu/${vmid}/console`, { type });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result.data, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error accessing console: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ==================== Maintenance Tools ====================

// Get Proxmox VE version
server.registerTool(
  "get_proxmox_version",
  {
    description: "Get Proxmox VE version",
  },
  async () => {
    try {
      const status = await makeRequest<{ version: string }>("get", "/version");
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(status, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error getting Proxmox version: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Get available updates
server.registerTool(
  "get_updates",
  {
    description: "Get available updates for Proxmox",
    inputSchema: {
      node: z.string().optional().describe("Node name (optional)"),
    },
  },
  async ({ node }) => {
    try {
      const endpoint = node ? `/nodes/${node}/apt/update` : "/apt/update";
      const result = await makeRequest<{ data: { package: string; version: string; size: number }[] }>("get", endpoint);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result.data, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error getting updates: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Upgrade Proxmox VE
server.registerTool(
  "upgrade_proxmox",
  {
    description: "Upgrade Proxmox VE",
    inputSchema: {
      node: z.string().describe("Node to upgrade"),
      dist_upgrade: z.boolean().optional().describe("Perform distribution upgrade"),
    },
  },
  async ({ node, dist_upgrade }) => {
    try {
      const params: Record<string, any> = {};
      if (dist_upgrade) params.dist_upgrade = "1";

      const result = await makeRequest<{ taskid: string }>("post", `/nodes/${node}/apt/upgrade`, params);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ success: true, taskid: result.taskid }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error upgrading Proxmox: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Get task status
server.registerTool(
  "get_task_status",
  {
    description: "Get status of a running task",
    inputSchema: {
      node: z.string().describe("Node where task is running"),
      taskid: z.string().describe("Task ID"),
    },
  },
  async ({ node, taskid }) => {
    try {
      const status = await makeRequest<TaskStatus>("get", `/nodes/${node}/tasks/${taskid}`);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(status, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error getting task status: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Start VM
server.registerTool(
  "start_vm",
  {
    description: "Start a VM",
    inputSchema: {
      node: z.string().describe("Node where VM is located"),
      vmid: z.number().describe("VM ID to start"),
    },
  },
  async ({ node, vmid }) => {
    try {
      await makeRequest<void>("post", `/nodes/${node}/qemu/${vmid}/status/start`);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ success: true, message: `VM ${vmid} started` }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error starting VM: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Stop VM
server.registerTool(
  "stop_vm",
  {
    description: "Stop a VM",
    inputSchema: {
      node: z.string().describe("Node where VM is located"),
      vmid: z.number().describe("VM ID to stop"),
      timeout: z.number().optional().describe("Timeout in seconds before force shutdown"),
    },
  },
  async ({ node, vmid, timeout }) => {
    try {
      const params: Record<string, any> = {};
      if (timeout) params.timeout = timeout.toString();

      await makeRequest<void>("post", `/nodes/${node}/qemu/${vmid}/status/stop`, params);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ success: true, message: `VM ${vmid} stopped` }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error stopping VM: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Shutdown VM
server.registerTool(
  "shutdown_vm",
  {
    description: "Shutdown a VM gracefully",
    inputSchema: {
      node: z.string().describe("Node where VM is located"),
      vmid: z.number().describe("VM ID to shutdown"),
      timeout: z.number().optional().describe("Timeout in seconds before force shutdown"),
    },
  },
  async ({ node, vmid, timeout }) => {
    try {
      const params: Record<string, any> = {};
      if (timeout) params.timeout = timeout.toString();

      await makeRequest<void>("post", `/nodes/${node}/qemu/${vmid}/status/shutdown`, params);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ success: true, message: `VM ${vmid} shutdown initiated` }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error shutting down VM: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Restart VM
server.registerTool(
  "restart_vm",
  {
    description: "Restart a VM",
    inputSchema: {
      node: z.string().describe("Node where VM is located"),
      vmid: z.number().describe("VM ID to restart"),
    },
  },
  async ({ node, vmid }) => {
    try {
      await makeRequest<void>("post", `/nodes/${node}/qemu/${vmid}/status/reboot`);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ success: true, message: `VM ${vmid} restarted` }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error restarting VM: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Start Container
server.registerTool(
  "start_container",
  {
    description: "Start a container",
    inputSchema: {
      node: z.string().describe("Node where container is located"),
      vmid: z.number().describe("Container ID to start"),
    },
  },
  async ({ node, vmid }) => {
    try {
      await makeRequest<void>("post", `/nodes/${node}/lxc/${vmid}/status/start`);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ success: true, message: `Container ${vmid} started` }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error starting container: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Stop Container
server.registerTool(
  "stop_container",
  {
    description: "Stop a container",
    inputSchema: {
      node: z.string().describe("Node where container is located"),
      vmid: z.number().describe("Container ID to stop"),
      timeout: z.number().optional().describe("Timeout in seconds before force shutdown"),
    },
  },
  async ({ node, vmid, timeout }) => {
    try {
      const params: Record<string, any> = {};
      if (timeout) params.timeout = timeout.toString();

      await makeRequest<void>("post", `/nodes/${node}/lxc/${vmid}/status/stop`, params);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ success: true, message: `Container ${vmid} stopped` }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error stopping container: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Shutdown Container
server.registerTool(
  "shutdown_container",
  {
    description: "Shutdown a container gracefully",
    inputSchema: {
      node: z.string().describe("Node where container is located"),
      vmid: z.number().describe("Container ID to shutdown"),
      timeout: z.number().optional().describe("Timeout in seconds before force shutdown"),
    },
  },
  async ({ node, vmid, timeout }) => {
    try {
      const params: Record<string, any> = {};
      if (timeout) params.timeout = timeout.toString();

      await makeRequest<void>("post", `/nodes/${node}/lxc/${vmid}/status/shutdown`, params);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ success: true, message: `Container ${vmid} shutdown initiated` }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error shutting down container: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Restart Container
server.registerTool(
  "restart_container",
  {
    description: "Restart a container",
    inputSchema: {
      node: z.string().describe("Node where container is located"),
      vmid: z.number().describe("Container ID to restart"),
    },
  },
  async ({ node, vmid }) => {
    try {
      await makeRequest<void>("post", `/nodes/${node}/lxc/${vmid}/status/reboot`);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ success: true, message: `Container ${vmid} restarted` }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error restarting container: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Get all running VMs and containers on a node
server.registerTool(
  "get_running_vms",
  {
    description: "Get all running VMs and containers on a node",
    inputSchema: {
      node: z.string().describe("Node name"),
    },
  },
  async ({ node }) => {
    try {
      const vms = await makeRequest<VMStatus[]>("get", `/nodes/${node}/qemu`);
      const containers = await makeRequest<ContainerStatus[]>("get", `/nodes/${node}/lxc`);
      
      const runningVms = vms.filter((vm) => vm.status === "running");
      const runningContainers = containers.filter((c) => c.status === "running");

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                running_vms: runningVms,
                running_containers: runningContainers,
                total_running: runningVms.length + runningContainers.length,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error getting running VMs: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ==================== VM Management Tools ====================

// SSH into VM
server.registerTool(
  "ssh_to_vm",
  {
    description: "SSH into a VM using qm console",
    inputSchema: {
      node: z.string().describe("Node where VM is located"),
      vmid: z.number().describe("VM ID"),
      username: z.string().describe("Username to login as"),
      command: z.string().optional().describe("Command to run (optional, defaults to interactive shell)"),
    },
  },
  async ({ node, vmid, username, command }) => {
    try {
      const params: Record<string, any> = {
        username,
        command: command || "/bin/bash",
      };

      const result = await makeRequest<{ data: any }>("post", `/nodes/${node}/qemu/${vmid}/ssh`, params);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result.data, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error SSH to VM: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Set VM IP address
server.registerTool(
  "set_vm_ip",
  {
    description: "Set IP address for a VM (requires guest agent)",
    inputSchema: {
      node: z.string().describe("Node where VM is located"),
      vmid: z.number().describe("VM ID"),
      interface: z.string().describe("Network interface name (e.g., 'eth0')"),
      ip: z.string().describe("IP address"),
      netmask: z.string().optional().describe("Netmask (e.g., '24')"),
      gateway: z.string().optional().describe("Gateway IP"),
    },
  },
  async ({ node, vmid, interface: iface, ip, netmask, gateway }) => {
    try {
      const params: Record<string, any> = {
        interface: iface,
        ip: ip,
      };
      
      if (netmask) params.netmask = netmask;
      if (gateway) params.gateway = gateway;

      const result = await makeRequest<{ data: any }>("post", `/nodes/${node}/qemu/${vmid}/agent/set-ip`, params);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result.data, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error setting VM IP: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Set VM hostname
server.registerTool(
  "set_vm_hostname",
  {
    description: "Set hostname for a VM (requires guest agent)",
    inputSchema: {
      node: z.string().describe("Node where VM is located"),
      vmid: z.number().describe("VM ID"),
      hostname: z.string().describe("New hostname"),
    },
  },
  async ({ node, vmid, hostname }) => {
    try {
      const result = await makeRequest<{ data: any }>("post", `/nodes/${node}/qemu/${vmid}/agent/set-hostname`, { hostname });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result.data, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error setting VM hostname: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Create VM user
server.registerTool(
  "create_vm_user",
  {
    description: "Create a new user in a VM (requires guest agent)",
    inputSchema: {
      node: z.string().describe("Node where VM is located"),
      vmid: z.number().describe("VM ID"),
      username: z.string().describe("Username to create"),
      password: z.string().optional().describe("Password (optional, for password auth)"),
      ssh_keys: z.string().optional().describe("SSH public keys (optional, for key auth)"),
      groups: z.string().optional().describe("Comma-separated list of groups"),
      shell: z.string().optional().describe("Shell (e.g., '/bin/bash')"),
    },
  },
  async ({ node, vmid, username, password, ssh_keys, groups, shell }) => {
    try {
      const params: Record<string, any> = { username };
      
      if (password) params.password = password;
      if (ssh_keys) params.ssh_keys = ssh_keys;
      if (groups) params.groups = groups;
      if (shell) params.shell = shell;

      const result = await makeRequest<{ data: any }>("post", `/nodes/${node}/qemu/${vmid}/agent/user-set-password`, params);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result.data, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error creating VM user: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Set VM user password
server.registerTool(
  "set_vm_user_password",
  {
    description: "Set password for an existing VM user (requires guest agent)",
    inputSchema: {
      node: z.string().describe("Node where VM is located"),
      vmid: z.number().describe("VM ID"),
      username: z.string().describe("Username"),
      password: z.string().describe("New password"),
    },
  },
  async ({ node, vmid, username, password }) => {
    try {
      const result = await makeRequest<{ data: any }>("post", `/nodes/${node}/qemu/${vmid}/agent/user-set-password`, {
        username,
        password,
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result.data, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error setting VM user password: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Run command in VM
server.registerTool(
  "run_vm_command",
  {
    description: "Run a command in a VM (requires guest agent)",
    inputSchema: {
      node: z.string().describe("Node where VM is located"),
      vmid: z.number().describe("VM ID"),
      command: z.string().describe("Command to run"),
      timeout: z.number().optional().describe("Timeout in seconds"),
    },
  },
  async ({ node, vmid, command, timeout }) => {
    try {
      const params: Record<string, any> = { command };
      
      if (timeout) params.timeout = timeout.toString();

      const result = await makeRequest<{ data: any }>("post", `/nodes/${node}/qemu/${vmid}/agent/exec`, params);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result.data, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error running command in VM: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Get VM network interfaces
server.registerTool(
  "get_vm_interfaces",
  {
    description: "Get network interfaces from a VM (requires guest agent)",
    inputSchema: {
      node: z.string().describe("Node where VM is located"),
      vmid: z.number().describe("VM ID"),
    },
  },
  async ({ node, vmid }) => {
    try {
      const result = await makeRequest<{ data: any }>("post", `/nodes/${node}/qemu/${vmid}/agent/network-get-interfaces`);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result.data, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error getting VM interfaces: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ==================== ISO Management Tools ====================

// List ISO files on a node
server.registerTool(
  "list_isos",
  {
    description: "List ISO files on a Proxmox node",
    inputSchema: {
      node: z.string().describe("Node name"),
      storage: z.string().optional().describe("Storage name (optional)"),
    },
  },
  async ({ node, storage }) => {
    try {
      const endpoint = storage
        ? `/nodes/${node}/storage/${storage}/content`
        : `/nodes/${node}/storage`;
      
      const result = await makeRequest<{ data: { name: string; size: number; format: string; vmid: number | null }[] }>("get", endpoint);
      
      const isos = (result.data || []).filter(item => item.format === 'iso' || item.name.endsWith('.iso'));
      
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(isos, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error listing ISOs: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Download ISO to a node
server.registerTool(
  "download_iso",
  {
    description: "Download an ISO file to a Proxmox node",
    inputSchema: {
      node: z.string().describe("Node to download ISO to"),
      storage: z.string().describe("Storage name (e.g., 'local', 'local-lvm')"),
      filename: z.string().describe("ISO filename (e.g., 'ubuntu-22.04.iso')"),
      url: z.string().describe("Download URL for the ISO"),
    },
  },
  async ({ node, storage, filename, url }) => {
    try {
      const result = await makeRequest<{ taskid: string }>("post", `/nodes/${node}/storage/${storage}/upload`, {
        filename,
        url,
      });
      
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ success: true, taskid: result.taskid }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error downloading ISO: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Delete ISO from a node
server.registerTool(
  "delete_iso",
  {
    description: "Delete an ISO file from a Proxmox node",
    inputSchema: {
      node: z.string().describe("Node name"),
      storage: z.string().describe("Storage name"),
      filename: z.string().describe("ISO filename to delete"),
    },
  },
  async ({ node, storage, filename }) => {
    try {
      await makeRequest<void>("delete", `/nodes/${node}/storage/${storage}/content/${filename}`);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ success: true, message: `ISO ${filename} deleted successfully` }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error deleting ISO: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Get ISO download status
server.registerTool(
  "get_iso_download_status",
  {
    description: "Get status of an ISO download task",
    inputSchema: {
      node: z.string().describe("Node where download is running"),
      taskid: z.string().describe("Task ID from download_iso response"),
    },
  },
  async ({ node, taskid }) => {
    try {
      const status = await makeRequest<TaskStatus>("get", `/nodes/${node}/tasks/${taskid}`);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(status, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error getting download status: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ==================== Firewall Management Tools ====================

// Enable firewall for a VM
server.registerTool(
  "enable_vm_firewall",
  {
    description: "Enable firewall for a VM",
    inputSchema: {
      node: z.string().describe("Node where VM is located"),
      vmid: z.number().describe("VM ID"),
    },
  },
  async ({ node, vmid }) => {
    try {
      await makeRequest<void>("post", `/nodes/${node}/qemu/${vmid}/config`, { firewall: 1 });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ success: true, message: `Firewall enabled for VM ${vmid}` }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error enabling VM firewall: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Disable firewall for a VM
server.registerTool(
  "disable_vm_firewall",
  {
    description: "Disable firewall for a VM",
    inputSchema: {
      node: z.string().describe("Node where VM is located"),
      vmid: z.number().describe("VM ID"),
    },
  },
  async ({ node, vmid }) => {
    try {
      await makeRequest<void>("post", `/nodes/${node}/qemu/${vmid}/config`, { firewall: 0 });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ success: true, message: `Firewall disabled for VM ${vmid}` }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error disabling VM firewall: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Enable firewall for a container
server.registerTool(
  "enable_container_firewall",
  {
    description: "Enable firewall for a container",
    inputSchema: {
      node: z.string().describe("Node where container is located"),
      vmid: z.number().describe("Container ID"),
    },
  },
  async ({ node, vmid }) => {
    try {
      await makeRequest<void>("post", `/nodes/${node}/lxc/${vmid}/config`, { firewall: 1 });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ success: true, message: `Firewall enabled for container ${vmid}` }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error enabling container firewall: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Disable firewall for a container
server.registerTool(
  "disable_container_firewall",
  {
    description: "Disable firewall for a container",
    inputSchema: {
      node: z.string().describe("Node where container is located"),
      vmid: z.number().describe("Container ID"),
    },
  },
  async ({ node, vmid }) => {
    try {
      await makeRequest<void>("post", `/nodes/${node}/lxc/${vmid}/config`, { firewall: 0 });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ success: true, message: `Firewall disabled for container ${vmid}` }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error disabling container firewall: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Create firewall rule for a VM
server.registerTool(
  "create_vm_firewall_rule",
  {
    description: "Create a firewall rule for a VM",
    inputSchema: {
      node: z.string().describe("Node where VM is located"),
      vmid: z.number().describe("VM ID"),
      rule: z.string().describe("Firewall rule (e.g., 'in,REJECT,22/tcp' or 'out,ACCEPT,any,any')"),
      pos: z.number().optional().describe("Position for the rule (optional)"),
    },
  },
  async ({ node, vmid, rule, pos }) => {
    try {
      const params: Record<string, any> = { rule };
      if (pos !== undefined) params.pos = pos;

      await makeRequest<void>("post", `/nodes/${node}/qemu/${vmid}/firewall/rules`, params);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ success: true, message: `Firewall rule created for VM ${vmid}` }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error creating VM firewall rule: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Create firewall rule for a container
server.registerTool(
  "create_container_firewall_rule",
  {
    description: "Create a firewall rule for a container",
    inputSchema: {
      node: z.string().describe("Node where container is located"),
      vmid: z.number().describe("Container ID"),
      rule: z.string().describe("Firewall rule (e.g., 'in,REJECT,22/tcp' or 'out,ACCEPT,any,any')"),
      pos: z.number().optional().describe("Position for the rule (optional)"),
    },
  },
  async ({ node, vmid, rule, pos }) => {
    try {
      const params: Record<string, any> = { rule };
      if (pos !== undefined) params.pos = pos;

      await makeRequest<void>("post", `/nodes/${node}/lxc/${vmid}/firewall/rules`, params);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ success: true, message: `Firewall rule created for container ${vmid}` }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error creating container firewall rule: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// List firewall rules for a VM
server.registerTool(
  "list_vm_firewall_rules",
  {
    description: "List firewall rules for a VM",
    inputSchema: {
      node: z.string().describe("Node where VM is located"),
      vmid: z.number().describe("VM ID"),
    },
  },
  async ({ node, vmid }) => {
    try {
      const result = await makeRequest<{ data: { action: string; proto: string; dport: string; sport: string; src: string; dst: string; enabled: number }[] }>("get", `/nodes/${node}/qemu/${vmid}/firewall/rules`);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result.data, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error listing VM firewall rules: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// List firewall rules for a container
server.registerTool(
  "list_container_firewall_rules",
  {
    description: "List firewall rules for a container",
    inputSchema: {
      node: z.string().describe("Node where container is located"),
      vmid: z.number().describe("Container ID"),
    },
  },
  async ({ node, vmid }) => {
    try {
      const result = await makeRequest<{ data: { action: string; proto: string; dport: string; sport: string; src: string; dst: string; enabled: number }[] }>("get", `/nodes/${node}/lxc/${vmid}/firewall/rules`);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result.data, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error listing container firewall rules: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Delete firewall rule for a VM
server.registerTool(
  "delete_vm_firewall_rule",
  {
    description: "Delete a firewall rule for a VM",
    inputSchema: {
      node: z.string().describe("Node where VM is located"),
      vmid: z.number().describe("VM ID"),
      ruleid: z.string().describe("Rule ID"),
    },
  },
  async ({ node, vmid, ruleid }) => {
    try {
      await makeRequest<void>("delete", `/nodes/${node}/qemu/${vmid}/firewall/rules/${ruleid}`);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ success: true, message: `Firewall rule ${ruleid} deleted for VM ${vmid}` }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error deleting VM firewall rule: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Delete firewall rule for a container
server.registerTool(
  "delete_container_firewall_rule",
  {
    description: "Delete a firewall rule for a container",
    inputSchema: {
      node: z.string().describe("Node where container is located"),
      vmid: z.number().describe("Container ID"),
      ruleid: z.string().describe("Rule ID"),
    },
  },
  async ({ node, vmid, ruleid }) => {
    try {
      await makeRequest<void>("delete", `/nodes/${node}/lxc/${vmid}/firewall/rules/${ruleid}`);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ success: true, message: `Firewall rule ${ruleid} deleted for container ${vmid}` }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error deleting container firewall rule: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ==================== Start Server ====================

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("Proxmox MCP server running on stdio");