#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "node:http";
import { Agent } from "node:https";
import { ZodError, z } from "zod";
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
  errors?: Record<string, string>;
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
          : new Agent({ rejectUnauthorized: false }),
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
      : new Agent({ rejectUnauthorized: false }),
  };

  let response;
  try {
    response = await axios.request<ProxmoxResponse<T>>({
      method,
      url: `${API_BASE}${endpoint}`,
      // DELETE params go as query string; POST/PUT as request body
      ...(method === "delete" ? { params: data } : { data }),
      ...config,
      validateStatus: () => true,
    });
  } catch (error) {
    const axiosError = error as AxiosError;
    const responseData = axiosError.response?.data as { errors?: Record<string, string> } | undefined;
    const errors = responseData?.errors;
    const errorMsg = errors
      ? Object.entries(errors).map(([k, v]) => `${k}: ${v}`).join('; ')
      : axiosError.message;
    throw new Error(`Proxmox API error: ${errorMsg}`);
  }

  if (response.data?.data !== undefined) {
    return response.data.data;
  }

  // Check if this is an error response (no data but has errors or non-2xx status)
  if (response.status >= 400 || response.data?.errors) {
    const errors = response.data?.errors;
    const errorMsg = errors
      ? Object.entries(errors).map(([k, v]) => `${k}: ${v}`).join('; ')
      : `Request failed with status ${response.status}`;
    throw new Error(errorMsg);
  }

  // Some endpoints return no data on success (e.g. DELETE)
  return undefined as T;
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

// Get node summary
server.registerTool(
  "get_summary",
  {
    description: "Get summary of Proxmox node resources",
    inputSchema: {
      node: z.string().describe("Node name"),
    },
  },
  async ({ node }) => {
    try {
      const summary = await makeRequest<any>("get", `/nodes/${node}/summary`);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(summary, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error getting node summary: ${error instanceof Error ? error.message : String(error)}`,
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
      if (disk) {
        // Parse "device: value" format (e.g., "scsi0: HDDVOL1:20,format=raw")
        const diskMatch = disk.match(/^(scsi|virtio|sata|ide)(\d+)\s*:\s*(.+)$/);
        if (diskMatch) {
          const paramKey = `${diskMatch[1]}${diskMatch[2]}`;
          if (!params[paramKey]) params[paramKey] = diskMatch[3];
        } else {
          // Assume it's a value for scsi0 if no device prefix
          if (!params.scsi0) params.scsi0 = disk;
        }
      }
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
        // Enable QEMU guest agent
        params.agent = "enabled=1";
      }

      const result = await makeRequest<string>("post", `/nodes/${node}/qemu`, params);

      // Proxmox returns a UPID string on success
      if (!result) throw new Error("VM creation failed: no response from Proxmox API");
      
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              vmid,
              upid: result,
              message: `VM ${vmid} created successfully on node ${node}. Note: VM is created in stopped state.`,
              parameters: Object.keys(params).length
            }, null, 2),
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

      const result = await makeRequest<string>("post", `/nodes/${node}/lxc`, params);

      // Proxmox returns a UPID string on success
      if (!result) throw new Error("Container creation failed: no response from Proxmox API");
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ success: true, vmid, upid: result }, null, 2),
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

// ==================== Template Management Tools ====================

// List templates on a node
server.registerTool(
  "list_templates",
  {
    description: "List templates on a Proxmox node",
    inputSchema: {
      node: z.string().describe("Node name"),
      storage: z.string().optional().describe("Storage name (optional)"),
      type: z.enum(["vm", "lxc"]).optional().describe("Template type (vm or lxc)"),
    },
  },
  async ({ node, storage, type }) => {
    try {
      let endpoint = `/nodes/${node}/storage`;
      if (storage) {
        endpoint = `/nodes/${node}/storage/${storage}/content`;
      }
      
      const result = await makeRequest<{ data: { name: string; size: number; format: string; vmid: number | null; template: number }[] }>("get", endpoint);
      
      let templates = (result.data || []).filter(item => item.template === 1);
      
      if (type === "vm") {
        templates = templates.filter(item => item.format === 'vmdk' || item.name.endsWith('.vmdk'));
      } else if (type === "lxc") {
        templates = templates.filter(item => item.format === 'vztmpl' || item.name.endsWith('.vztmpl'));
      }
      
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(templates, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error listing templates: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Create template from VM
server.registerTool(
  "create_template_from_vm",
  {
    description: "Create a template from a VM",
    inputSchema: {
      node: z.string().describe("Node where VM is located"),
      vmid: z.number().describe("VM ID to convert to template"),
      storage: z.string().optional().describe("Storage name for the template"),
    },
  },
  async ({ node, vmid, storage }) => {
    try {
      const params: Record<string, any> = { template: 1 };
      if (storage) params.storage = storage;
      
      await makeRequest<void>("post", `/nodes/${node}/qemu/${vmid}`, params);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ success: true, message: `Template created from VM ${vmid}` }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error creating template: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Create template from container
server.registerTool(
  "create_template_from_container",
  {
    description: "Create a template from a container",
    inputSchema: {
      node: z.string().describe("Node where container is located"),
      vmid: z.number().describe("Container ID to convert to template"),
      storage: z.string().optional().describe("Storage name for the template"),
    },
  },
  async ({ node, vmid, storage }) => {
    try {
      const params: Record<string, any> = { template: 1 };
      if (storage) params.storage = storage;
      
      await makeRequest<void>("post", `/nodes/${node}/lxc/${vmid}`, params);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ success: true, message: `Template created from container ${vmid}` }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error creating template: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Delete template
server.registerTool(
  "delete_template",
  {
    description: "Delete a template from Proxmox",
    inputSchema: {
      node: z.string().describe("Node where template is located"),
      vmid: z.number().describe("Template ID to delete"),
      force: z.boolean().optional().describe("Force delete"),
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
            text: JSON.stringify({ success: true, message: `Template ${vmid} deleted successfully` }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error deleting template: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ==================== Backup and Restore Tools ====================

// Create VM backup
server.registerTool(
  "create_vm_backup",
  {
    description: "Create a backup of a VM",
    inputSchema: {
      node: z.string().describe("Node where VM is located"),
      vmid: z.number().describe("VM ID to backup"),
      storage: z.string().describe("Storage name for the backup"),
      mode: z.enum(["stop", "suspend", "snapshot"]).optional().describe("Backup mode (stop, suspend, or snapshot)"),
      compression: z.enum(["gzip", "bzip2", "lz4", "zstd"]).optional().describe("Compression algorithm"),
      dumpdir: z.string().optional().describe("Backup directory"),
      exclude: z.string().optional().describe("Exclude disks (comma-separated, e.g., 'sata0,sata1')"),
      backupdir: z.string().optional().describe("Backup directory"),
      stdout: z.boolean().optional().describe("Output backup to stdout"),
      pause: z.boolean().optional().describe("Pause VM during backup"),
      prune: z.boolean().optional().describe("Prune old backups"),
      backupId: z.string().optional().describe("Backup ID"),
    },
  },
  async ({ node, vmid, storage, mode, compression, dumpdir, exclude, backupdir, stdout, pause, prune, backupId }) => {
    try {
      const params: Record<string, any> = { vmid, storage };
      if (mode) params.mode = mode;
      if (compression) params.compression = compression;
      if (dumpdir) params.dumpdir = dumpdir;
      if (exclude) params.exclude = exclude;
      if (backupdir) params.backupdir = backupdir;
      if (stdout !== undefined) params.stdout = stdout ? "1" : "0";
      if (pause !== undefined) params.pause = pause ? "1" : "0";
      if (prune !== undefined) params.prune = prune ? "1" : "0";
      if (backupId) params.backupId = backupId;
      
      const result = await makeRequest<{ taskid: string }>("post", `/nodes/${node}/backup`, params);
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
            text: `Error creating VM backup: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Create container backup
server.registerTool(
  "create_container_backup",
  {
    description: "Create a backup of a container",
    inputSchema: {
      node: z.string().describe("Node where container is located"),
      vmid: z.number().describe("Container ID to backup"),
      storage: z.string().describe("Storage name for the backup"),
      mode: z.enum(["stop", "suspend", "snapshot"]).optional().describe("Backup mode (stop, suspend, or snapshot)"),
      compression: z.enum(["gzip", "bzip2", "lz4", "zstd"]).optional().describe("Compression algorithm"),
      dumpdir: z.string().optional().describe("Backup directory"),
      exclude: z.string().optional().describe("Exclude volumes (comma-separated)"),
      backupdir: z.string().optional().describe("Backup directory"),
      stdout: z.boolean().optional().describe("Output backup to stdout"),
      pause: z.boolean().optional().describe("Pause container during backup"),
      prune: z.boolean().optional().describe("Prune old backups"),
      backupId: z.string().optional().describe("Backup ID"),
    },
  },
  async ({ node, vmid, storage, mode, compression, dumpdir, exclude, backupdir, stdout, pause, prune, backupId }) => {
    try {
      const params: Record<string, any> = { vmid, storage };
      if (mode) params.mode = mode;
      if (compression) params.compression = compression;
      if (dumpdir) params.dumpdir = dumpdir;
      if (exclude) params.exclude = exclude;
      if (backupdir) params.backupdir = backupdir;
      if (stdout !== undefined) params.stdout = stdout ? "1" : "0";
      if (pause !== undefined) params.pause = pause ? "1" : "0";
      if (prune !== undefined) params.prune = prune ? "1" : "0";
      if (backupId) params.backupId = backupId;
      
      const result = await makeRequest<{ taskid: string }>("post", `/nodes/${node}/backup`, params);
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
            text: `Error creating container backup: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// List backups
server.registerTool(
  "list_backups",
  {
    description: "List available backups",
    inputSchema: {
      node: z.string().describe("Node name"),
      backupdir: z.string().optional().describe("Backup directory"),
    },
  },
  async ({ node, backupdir }) => {
    try {
      let endpoint = `/nodes/${node}/backup`;
      if (backupdir) {
        endpoint = `/nodes/${node}/backup?backupdir=${encodeURIComponent(backupdir)}`;
      }
      
      const result = await makeRequest<{ data: { backupfile: string; vmid: number; type: string; size: number; timestamp: number; format: string; checksum: string }[] }>("get", endpoint);
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
            text: `Error listing backups: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Restore VM from backup
server.registerTool(
  "restore_vm_backup",
  {
    description: "Restore a VM from backup",
    inputSchema: {
      node: z.string().describe("Node where backup is located"),
      backupfile: z.string().describe("Backup file path (e.g., 'vm/100/backup.tar')"),
      storage: z.string().describe("Target storage"),
      format: z.enum(["tar", "vma", "raw", "qcow2", "vmdk"]).optional().describe("Backup format"),
      unprivileged: z.boolean().optional().describe("Restore as unprivileged container"),
      description: z.string().optional().describe("Description"),
      full: z.boolean().optional().describe("Full restore"),
      skiplock: z.boolean().optional().describe("Skip locks"),
      ignoreErrors: z.boolean().optional().describe("Ignore errors"),
    },
  },
  async ({ node, backupfile, storage, format, unprivileged, description, full, skiplock, ignoreErrors }) => {
    try {
      const params: Record<string, any> = { backupfile, storage };
      if (format) params.format = format;
      if (unprivileged !== undefined) params.unprivileged = unprivileged ? "1" : "0";
      if (description) params.description = description;
      if (full !== undefined) params.full = full ? "1" : "0";
      if (skiplock !== undefined) params.skiplock = skiplock ? "1" : "0";
      if (ignoreErrors !== undefined) params.ignoreErrors = ignoreErrors ? "1" : "0";
      
      const result = await makeRequest<{ taskid: string }>("post", `/nodes/${node}/restore`, params);
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
            text: `Error restoring VM from backup: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Restore container from backup
server.registerTool(
  "restore_container_backup",
  {
    description: "Restore a container from backup",
    inputSchema: {
      node: z.string().describe("Node where backup is located"),
      backupfile: z.string().describe("Backup file path (e.g., 'lxc/100/backup.tar')"),
      storage: z.string().describe("Target storage"),
      format: z.enum(["tar", "vma"]).optional().describe("Backup format"),
      unprivileged: z.boolean().optional().describe("Restore as unprivileged container"),
      description: z.string().optional().describe("Description"),
      skiplock: z.boolean().optional().describe("Skip locks"),
      ignoreErrors: z.boolean().optional().describe("Ignore errors"),
    },
  },
  async ({ node, backupfile, storage, format, unprivileged, description, skiplock, ignoreErrors }) => {
    try {
      const params: Record<string, any> = { backupfile, storage };
      if (format) params.format = format;
      if (unprivileged !== undefined) params.unprivileged = unprivileged ? "1" : "0";
      if (description) params.description = description;
      if (skiplock !== undefined) params.skiplock = skiplock ? "1" : "0";
      if (ignoreErrors !== undefined) params.ignoreErrors = ignoreErrors ? "1" : "0";
      
      const result = await makeRequest<{ taskid: string }>("post", `/nodes/${node}/restore`, params);
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
            text: `Error restoring container from backup: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Delete backup
server.registerTool(
  "delete_backup",
  {
    description: "Delete a backup",
    inputSchema: {
      node: z.string().describe("Node where backup is located"),
      backupfile: z.string().describe("Backup file path"),
    },
  },
  async ({ node, backupfile }) => {
    try {
      await makeRequest<void>("delete", `/nodes/${node}/backup?backupfile=${encodeURIComponent(backupfile)}`);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ success: true, message: `Backup ${backupfile} deleted successfully` }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error deleting backup: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ==================== HA (High Availability) Management Tools ====================

// Enable HA for a VM
server.registerTool(
  "enable_vm_ha",
  {
    description: "Enable High Availability for a VM",
    inputSchema: {
      node: z.string().describe("Node where VM is located"),
      vmid: z.number().describe("VM ID"),
      group: z.string().optional().describe("HA group name"),
      max_restart: z.number().optional().describe("Maximum number of restarts"),
      restart_delay: z.number().optional().describe("Restart delay in seconds"),
      state: z.enum(["started", "stopped", "fenced", "migrated"]).optional().describe("Desired state"),
    },
  },
  async ({ node, vmid, group, max_restart, restart_delay, state }) => {
    try {
      const params: Record<string, any> = { vmid };
      if (group) params.group = group;
      if (max_restart !== undefined) params.max_restart = max_restart;
      if (restart_delay !== undefined) params.restart_delay = restart_delay;
      if (state) params.state = state;
      
      await makeRequest<void>("post", `/nodes/${node}/ha/resources`, params);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ success: true, message: `HA enabled for VM ${vmid}` }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error enabling HA for VM: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Enable HA for a container
server.registerTool(
  "enable_container_ha",
  {
    description: "Enable High Availability for a container",
    inputSchema: {
      node: z.string().describe("Node where container is located"),
      vmid: z.number().describe("Container ID"),
      group: z.string().optional().describe("HA group name"),
      max_restart: z.number().optional().describe("Maximum number of restarts"),
      restart_delay: z.number().optional().describe("Restart delay in seconds"),
      state: z.enum(["started", "stopped", "fenced", "migrated"]).optional().describe("Desired state"),
    },
  },
  async ({ node, vmid, group, max_restart, restart_delay, state }) => {
    try {
      const params: Record<string, any> = { vmid };
      if (group) params.group = group;
      if (max_restart !== undefined) params.max_restart = max_restart;
      if (restart_delay !== undefined) params.restart_delay = restart_delay;
      if (state) params.state = state;
      
      await makeRequest<void>("post", `/nodes/${node}/ha/resources`, params);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ success: true, message: `HA enabled for container ${vmid}` }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error enabling HA for container: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Disable HA for a VM
server.registerTool(
  "disable_vm_ha",
  {
    description: "Disable High Availability for a VM",
    inputSchema: {
      node: z.string().describe("Node where VM is located"),
      vmid: z.number().describe("VM ID"),
    },
  },
  async ({ node, vmid }) => {
    try {
      await makeRequest<void>("delete", `/nodes/${node}/ha/resources/${vmid}`);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ success: true, message: `HA disabled for VM ${vmid}` }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error disabling HA for VM: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Disable HA for a container
server.registerTool(
  "disable_container_ha",
  {
    description: "Disable High Availability for a container",
    inputSchema: {
      node: z.string().describe("Node where container is located"),
      vmid: z.number().describe("Container ID"),
    },
  },
  async ({ node, vmid }) => {
    try {
      await makeRequest<void>("delete", `/nodes/${node}/ha/resources/${vmid}`);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ success: true, message: `HA disabled for container ${vmid}` }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error disabling HA for container: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Get HA status
server.registerTool(
  "get_ha_status",
  {
    description: "Get High Availability status",
    inputSchema: {
      node: z.string().describe("Node name"),
    },
  },
  async ({ node }) => {
    try {
      const resources = await makeRequest<{ data: { id: string; type: string; group: string; state: string; managed: number }[] }>("get", `/nodes/${node}/ha/resources`);
      const groups = await makeRequest<{ data: { name: string; max_relocate: number; max_restart: number }[] }>("get", `/nodes/${node}/ha/groups`);
      
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ resources, groups }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error getting HA status: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ==================== Migration Support Tools ====================

// Migrate a VM to another node
server.registerTool(
  "migrate_vm",
  {
    description: "Migrate a VM to another node",
    inputSchema: {
      node: z.string().describe("Current node where VM is located"),
      vmid: z.number().describe("VM ID"),
      target: z.string().describe("Target node for migration"),
      online: z.boolean().optional().describe("Online migration (without shutdown)"),
      force: z.boolean().optional().describe("Force migration (ignore safety checks)"),
      stop: z.boolean().optional().describe("Stop VM after migration"),
      stateonly: z.boolean().optional().describe("Only migrate VM state"),
      with_local_disks: z.boolean().optional().describe("Migrate with local disks"),
    },
  },
  async ({ node, vmid, target, online, force, stop, stateonly, with_local_disks }) => {
    try {
      const params: Record<string, any> = { target, vmid };
      if (online !== undefined) params.online = online ? "1" : "0";
      if (force !== undefined) params.force = force ? "1" : "0";
      if (stop !== undefined) params.stop = stop ? "1" : "0";
      if (stateonly !== undefined) params.stateonly = stateonly ? "1" : "0";
      if (with_local_disks !== undefined) params.with_local_disks = with_local_disks ? "1" : "0";
      
      const result = await makeRequest<{ taskid: string }>("post", `/nodes/${node}/qemu/${vmid}/migrate`, params);
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
            text: `Error migrating VM: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Migrate a container to another node
server.registerTool(
  "migrate_container",
  {
    description: "Migrate a container to another node",
    inputSchema: {
      node: z.string().describe("Current node where container is located"),
      vmid: z.number().describe("Container ID"),
      target: z.string().describe("Target node for migration"),
      online: z.boolean().optional().describe("Online migration (without shutdown)"),
      force: z.boolean().optional().describe("Force migration (ignore safety checks)"),
      stop: z.boolean().optional().describe("Stop container after migration"),
      stateonly: z.boolean().optional().describe("Only migrate container state"),
      with_local_disks: z.boolean().optional().describe("Migrate with local disks"),
    },
  },
  async ({ node, vmid, target, online, force, stop, stateonly, with_local_disks }) => {
    try {
      const params: Record<string, any> = { target, vmid };
      if (online !== undefined) params.online = online ? "1" : "0";
      if (force !== undefined) params.force = force ? "1" : "0";
      if (stop !== undefined) params.stop = stop ? "1" : "0";
      if (stateonly !== undefined) params.stateonly = stateonly ? "1" : "0";
      if (with_local_disks !== undefined) params.with_local_disks = with_local_disks ? "1" : "0";
      
      const result = await makeRequest<{ taskid: string }>("post", `/nodes/${node}/lxc/${vmid}/migrate`, params);
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
            text: `Error migrating container: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ==================== Snapshot Management Tools ====================

// Create snapshot for a VM
server.registerTool(
  "create_vm_snapshot",
  {
    description: "Create a snapshot for a VM",
    inputSchema: {
      node: z.string().describe("Node where VM is located"),
      vmid: z.number().describe("VM ID"),
      snapshotname: z.string().describe("Snapshot name"),
      description: z.string().optional().describe("Snapshot description"),
      memory: z.boolean().optional().describe("Include VM memory in snapshot"),
      vmstate: z.boolean().optional().describe("Include VM state in snapshot"),
    },
  },
  async ({ node, vmid, snapshotname, description, memory, vmstate }) => {
    try {
      const params: Record<string, any> = { snapshotname };
      if (description) params.description = description;
      if (memory !== undefined) params.memory = memory ? "1" : "0";
      if (vmstate !== undefined) params.vmstate = vmstate ? "1" : "0";
      
      const result = await makeRequest<{ taskid: string }>("post", `/nodes/${node}/qemu/${vmid}/snapshot`, params);
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
            text: `Error creating VM snapshot: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Create snapshot for a container
server.registerTool(
  "create_container_snapshot",
  {
    description: "Create a snapshot for a container",
    inputSchema: {
      node: z.string().describe("Node where container is located"),
      vmid: z.number().describe("Container ID"),
      snapshotname: z.string().describe("Snapshot name"),
      description: z.string().optional().describe("Snapshot description"),
    },
  },
  async ({ node, vmid, snapshotname, description }) => {
    try {
      const params: Record<string, any> = { snapshotname };
      if (description) params.description = description;
      
      const result = await makeRequest<{ taskid: string }>("post", `/nodes/${node}/lxc/${vmid}/snapshot`, params);
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
            text: `Error creating container snapshot: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// List snapshots for a VM
server.registerTool(
  "list_vm_snapshots",
  {
    description: "List snapshots for a VM",
    inputSchema: {
      node: z.string().describe("Node where VM is located"),
      vmid: z.number().describe("VM ID"),
    },
  },
  async ({ node, vmid }) => {
    try {
      const result = await makeRequest<{ data: { name: string; description: string; parent: string; snapshottime: number; vmstate: number }[] }>("get", `/nodes/${node}/qemu/${vmid}/snapshot`);
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
            text: `Error listing VM snapshots: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// List snapshots for a container
server.registerTool(
  "list_container_snapshots",
  {
    description: "List snapshots for a container",
    inputSchema: {
      node: z.string().describe("Node where container is located"),
      vmid: z.number().describe("Container ID"),
    },
  },
  async ({ node, vmid }) => {
    try {
      const result = await makeRequest<{ data: { name: string; description: string; parent: string; snapshottime: number }[] }>("get", `/nodes/${node}/lxc/${vmid}/snapshot`);
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
            text: `Error listing container snapshots: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Restore VM snapshot
server.registerTool(
  "restore_vm_snapshot",
  {
    description: "Restore a VM snapshot",
    inputSchema: {
      node: z.string().describe("Node where VM is located"),
      vmid: z.number().describe("VM ID"),
      snapshotname: z.string().describe("Snapshot name to restore"),
    },
  },
  async ({ node, vmid, snapshotname }) => {
    try {
      await makeRequest<void>("post", `/nodes/${node}/qemu/${vmid}/snapshot/${snapshotname}/rollback`);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ success: true, message: `VM snapshot ${snapshotname} restored` }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error restoring VM snapshot: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Restore container snapshot
server.registerTool(
  "restore_container_snapshot",
  {
    description: "Restore a container snapshot",
    inputSchema: {
      node: z.string().describe("Node where container is located"),
      vmid: z.number().describe("Container ID"),
      snapshotname: z.string().describe("Snapshot name to restore"),
    },
  },
  async ({ node, vmid, snapshotname }) => {
    try {
      await makeRequest<void>("post", `/nodes/${node}/lxc/${vmid}/snapshot/${snapshotname}/rollback`);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ success: true, message: `Container snapshot ${snapshotname} restored` }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error restoring container snapshot: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Delete VM snapshot
server.registerTool(
  "delete_vm_snapshot",
  {
    description: "Delete a VM snapshot",
    inputSchema: {
      node: z.string().describe("Node where VM is located"),
      vmid: z.number().describe("VM ID"),
      snapshotname: z.string().describe("Snapshot name to delete"),
    },
  },
  async ({ node, vmid, snapshotname }) => {
    try {
      await makeRequest<void>("delete", `/nodes/${node}/qemu/${vmid}/snapshot/${snapshotname}`);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ success: true, message: `VM snapshot ${snapshotname} deleted` }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error deleting VM snapshot: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Delete container snapshot
server.registerTool(
  "delete_container_snapshot",
  {
    description: "Delete a container snapshot",
    inputSchema: {
      node: z.string().describe("Node where container is located"),
      vmid: z.number().describe("Container ID"),
      snapshotname: z.string().describe("Snapshot name to delete"),
    },
  },
  async ({ node, vmid, snapshotname }) => {
    try {
      await makeRequest<void>("delete", `/nodes/${node}/lxc/${vmid}/snapshot/${snapshotname}`);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ success: true, message: `Container snapshot ${snapshotname} deleted` }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error deleting container snapshot: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ==================== Resource Pool Management Tools ====================

// Create resource pool
server.registerTool(
  "create_resource_pool",
  {
    description: "Create a new resource pool",
    inputSchema: {
      poolid: z.string().describe("Pool ID (unique name)"),
      comment: z.string().optional().describe("Pool description"),
    },
  },
  async ({ poolid, comment }) => {
    try {
      const params: Record<string, any> = { poolid };
      if (comment) params.comment = comment;
      
      await makeRequest<void>("post", "/pools", params);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ success: true, message: `Resource pool ${poolid} created` }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error creating resource pool: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// List resource pools
server.registerTool(
  "list_resource_pools",
  {
    description: "List all resource pools",
  },
  async () => {
    try {
      const result = await makeRequest<{ data: { poolid: string; comment: string; members: number[] }[] }>("get", "/pools");
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
            text: `Error listing resource pools: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Get resource pool status
server.registerTool(
  "get_resource_pool_status",
  {
    description: "Get status of a resource pool",
    inputSchema: {
      poolid: z.string().describe("Pool ID"),
    },
  },
  async ({ poolid }) => {
    try {
      const result = await makeRequest<{ data: { poolid: string; comment: string; members: { vmid: number; type: string; name: string; status: string }[] } }>("get", `/pools/${poolid}`);
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
            text: `Error getting resource pool status: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Delete resource pool
server.registerTool(
  "delete_resource_pool",
  {
    description: "Delete a resource pool",
    inputSchema: {
      poolid: z.string().describe("Pool ID to delete"),
      force: z.boolean().optional().describe("Force delete (even if pool has members)"),
    },
  },
  async ({ poolid, force }) => {
    try {
      const params: Record<string, any> = {};
      if (force) params.force = "1";
      
      await makeRequest<void>("delete", `/pools/${poolid}`, params);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ success: true, message: `Resource pool ${poolid} deleted` }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error deleting resource pool: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Add VM to resource pool
server.registerTool(
  "add_vm_to_pool",
  {
    description: "Add a VM to a resource pool",
    inputSchema: {
      poolid: z.string().describe("Pool ID"),
      vmid: z.number().describe("VM ID"),
    },
  },
  async ({ poolid, vmid }) => {
    try {
      await makeRequest<void>("post", `/pools/${poolid}`, { vmid });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ success: true, message: `VM ${vmid} added to pool ${poolid}` }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error adding VM to pool: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Remove VM from resource pool
server.registerTool(
  "remove_vm_from_pool",
  {
    description: "Remove a VM from a resource pool",
    inputSchema: {
      poolid: z.string().describe("Pool ID"),
      vmid: z.number().describe("VM ID"),
    },
  },
  async ({ poolid, vmid }) => {
    try {
      await makeRequest<void>("delete", `/pools/${poolid}?vmid=${vmid}`);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ success: true, message: `VM ${vmid} removed from pool ${poolid}` }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error removing VM from pool: ${error instanceof Error ? error.message : String(error)}`,
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
      // If storage is specified, list content from that storage
      // Otherwise, list all storages and filter for ISO files
      let isos: any[] = [];
      
      if (storage) {
        // Get content from specific storage
        const result = await makeRequest<any[]>("get", `/nodes/${node}/storage/${storage}/content`);
        isos = result.filter(item => item.content === "iso");
      } else {
        // Get all storages, then get content from each
        const storages = await makeRequest<any[]>("get", `/nodes/${node}/storage`);
        
        // Filter for storages that can contain ISO files
        const isoStorages = storages.filter(s =>
          s.content && (s.content as string).includes("iso")
        );
        
        // Get ISO files from each storage
        for (const storageItem of isoStorages) {
          try {
            const content = await makeRequest<any[]>("get", `/nodes/${node}/storage/${storageItem.storage}/content`);
            const storageIsos = content.filter(item => item.content === "iso");
            isos.push(...storageIsos.map(iso => ({
              ...iso,
              storage: storageItem.storage
            })));
          } catch (err) {
            // Skip storage if we can't access it
            continue;
          }
        }
      }
      
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

// Environment variable for HTTP port
const HTTP_PORT = process.env.HTTP_PORT || "3333";

// Check if HTTP mode is enabled
const HTTP_MODE = process.env.HTTP_MODE === "true";

if (HTTP_MODE) {
 // HTTP transport mode for n8n compatibility
 const http = await import("node:http");
 
 // Create HTTP transport with stateless mode (no session management)
 const transport = new StreamableHTTPServerTransport({
   sessionIdGenerator: undefined, // Stateless mode
 });
 
 // Connect the server to the transport
 await server.connect(transport);
 
 // Create HTTP server
 const serverHttp = http.createServer(async (req, res) => {
   // Use transport.handleRequest to process MCP requests
   try {
     await transport.handleRequest(req, res);
   } catch (error) {
     console.error("HTTP request error:", error);
     res.writeHead(500, { "Content-Type": "application/json" });
     res.end(JSON.stringify({ error: "Internal server error" }));
   }
 });
 
 serverHttp.listen(parseInt(HTTP_PORT), () => {
   console.error(`Proxmox MCP server running on HTTP port ${HTTP_PORT}`);
   console.error(`n8n configuration: http://localhost:${HTTP_PORT}/`);
 });
} else {
 // Stdio transport mode (default)
 const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
 const transport = new StdioServerTransport();
 await server.connect(transport);
 console.error("Proxmox MCP server running on stdio");
}