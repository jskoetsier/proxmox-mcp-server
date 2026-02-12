#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import axios from "axios";
// Environment variables for Proxmox configuration
const PROXMOX_HOST = process.env.PROXMOX_HOST;
const PROXMOX_USER = process.env.PROXMOX_USER;
const PROXMOX_PASSWORD = process.env.PROXMOX_PASSWORD;
const PROXMOX_PORT = process.env.PROXMOX_PORT || "8006";
const PROXMOX_VERIFY_SSL = process.env.PROXMOX_VERIFY_SSL !== "false";
if (!PROXMOX_HOST || !PROXMOX_USER || !PROXMOX_PASSWORD) {
    throw new Error("PROXMOX_HOST, PROXMOX_USER, and PROXMOX_PASSWORD environment variables are required");
}
// Proxmox API base URL
const API_BASE = `https://${PROXMOX_HOST}:${PROXMOX_PORT}/api2/json`;
// Create MCP server
const server = new McpServer({
    name: "proxmox-mcp-server",
    version: "1.0.0",
}, {
    capabilities: {
        tools: {},
    },
});
// Helper function to get authentication ticket
async function getTicket() {
    try {
        const response = await axios.post(`${API_BASE}/access/ticket`, {
            username: PROXMOX_USER,
            password: PROXMOX_PASSWORD,
        }, {
            validateStatus: () => true,
            httpsAgent: PROXMOX_VERIFY_SSL
                ? undefined
                : new (require("https").Agent)({ rejectUnauthorized: false }),
        });
        if (response.data?.data) {
            return response.data.data;
        }
        throw new Error("Failed to get authentication ticket");
    }
    catch (error) {
        throw new Error(`Authentication failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}
// Helper function to make authenticated requests
async function makeRequest(method, endpoint, data) {
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
        const response = await axios.request({
            method,
            url: `${API_BASE}${endpoint}`,
            data,
            ...config,
            validateStatus: () => true,
        });
        if (response.data?.data !== undefined) {
            return response.data.data;
        }
        throw new Error(response.data?.errors?.[0] ||
            `Request failed with status ${response.status}`);
    }
    catch (error) {
        const axiosError = error;
        const errors = axiosError.response?.data;
        throw new Error(`Proxmox API error: ${errors?.errors?.[0] || axiosError.message}`);
    }
}
// ==================== Status Tools ====================
// Get node status
server.registerTool("get_node_status", {
    description: "Get status of Proxmox nodes",
    inputSchema: {
        node: z.string().optional().describe("Node name (optional, defaults to all nodes)"),
    },
}, async ({ node }) => {
    try {
        const endpoint = node ? `/nodes/${node}/status` : "/nodes";
        const status = await makeRequest("get", endpoint);
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(status, null, 2),
                },
            ],
        };
    }
    catch (error) {
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
});
// Get storage status
server.registerTool("get_storage_status", {
    description: "Get status of Proxmox storage",
    inputSchema: {
        node: z.string().optional().describe("Node name (optional)"),
        storage: z.string().optional().describe("Storage name (optional)"),
    },
}, async ({ node, storage }) => {
    try {
        let endpoint = "/storage";
        if (node) {
            endpoint = node ? `/nodes/${node}/storage` : "/storage";
        }
        if (storage) {
            endpoint = node ? `/nodes/${node}/storage/${storage}/status` : `/storage/${storage}/status`;
        }
        const status = await makeRequest("get", endpoint);
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(status, null, 2),
                },
            ],
        };
    }
    catch (error) {
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
});
// Get cluster status
server.registerTool("get_cluster_status", {
    description: "Get Proxmox cluster status",
}, async () => {
    try {
        const status = await makeRequest("get", "/cluster/status");
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(status, null, 2),
                },
            ],
        };
    }
    catch (error) {
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
});
// Get VM status
server.registerTool("get_vm_status", {
    description: "Get status of Proxmox VMs",
    inputSchema: {
        node: z.string().optional().describe("Node name (optional)"),
        vmid: z.number().optional().describe("VM ID (optional)"),
    },
}, async ({ node, vmid }) => {
    try {
        let endpoint = "/qemu";
        if (node) {
            endpoint = `/nodes/${node}/qemu`;
        }
        if (vmid) {
            endpoint = node ? `/nodes/${node}/qemu/${vmid}` : `/qemu/${vmid}`;
        }
        const status = await makeRequest("get", endpoint);
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(status, null, 2),
                },
            ],
        };
    }
    catch (error) {
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
});
// Get container status
server.registerTool("get_container_status", {
    description: "Get status of Proxmox containers",
    inputSchema: {
        node: z.string().optional().describe("Node name (optional)"),
        vmid: z.number().optional().describe("Container ID (optional)"),
    },
}, async ({ node, vmid }) => {
    try {
        let endpoint = "/lxc";
        if (node) {
            endpoint = `/nodes/${node}/lxc`;
        }
        if (vmid) {
            endpoint = node ? `/nodes/${node}/lxc/${vmid}` : `/lxc/${vmid}`;
        }
        const status = await makeRequest("get", endpoint);
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(status, null, 2),
                },
            ],
        };
    }
    catch (error) {
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
});
// ==================== Creation Tools ====================
// Create VM
server.registerTool("create_vm", {
    description: "Create a new VM on Proxmox",
    inputSchema: {
        node: z.string().describe("Node to create VM on"),
        vmid: z.number().describe("VM ID (unique, 100-999999999)"),
        name: z.string().optional().describe("VM name"),
        cores: z.number().min(1).max(128).optional().describe("Number of CPU cores"),
        sockets: z.number().min(1).max(16).optional().describe("Number of CPU sockets"),
        memory: z.number().min(16).describe("Memory in MB"),
        net0: z.string().optional().describe("Network interface configuration (e.g., 'virtio=00:11:22:33:44:55,bridge=vmbr0')"),
        disk: z.string().optional().describe("Disk configuration (e.g., 'virtio0: local-lvm:20')"),
        ostype: z.string().optional().describe("OS type (e.g., 'l26', 'windows', 'macos')"),
        scsihw: z.string().optional().describe("SCSI controller (e.g., 'virtio-scsi-pci')"),
        bootdisk: z.string().optional().describe("Boot disk (e.g., 'virtio0')"),
        onboot: z.boolean().optional().describe("Start VM on boot"),
        desc: z.string().optional().describe("Description"),
    },
}, async ({ node, vmid, name, cores, sockets, memory, net0, disk, ostype, scsihw, bootdisk, onboot, desc }) => {
    try {
        const params = { vmid, memory };
        if (name)
            params.name = name;
        if (cores)
            params.cores = cores;
        if (sockets)
            params.sockets = sockets;
        if (net0)
            params.net0 = net0;
        if (disk)
            params.disk = disk;
        if (ostype)
            params.ostype = ostype;
        if (scsihw)
            params.scsihw = scsihw;
        if (bootdisk)
            params.bootdisk = bootdisk;
        if (onboot !== undefined)
            params.onboot = onboot ? "1" : "0";
        if (desc)
            params.desc = desc;
        const result = await makeRequest("post", `/nodes/${node}/qemu`, params);
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({ success: true, vmid: result.vmid }, null, 2),
                },
            ],
        };
    }
    catch (error) {
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
});
// Create Container
server.registerTool("create_container", {
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
}, async ({ node, vmid, hostname, ostemplate, cores, memory, swap, net0, ipaddr, gateway, password, nameserver, ssh_public_keys, unprivileged, description }) => {
    try {
        const params = { vmid, hostname, ostemplate, memory };
        if (cores)
            params.cores = cores;
        if (swap)
            params.swap = swap;
        if (net0)
            params.net0 = net0;
        if (ipaddr)
            params.ipaddr = ipaddr;
        if (gateway)
            params.gateway = gateway;
        if (password)
            params.password = password;
        if (nameserver)
            params.nameserver = nameserver;
        if (ssh_public_keys)
            params.ssh_public_keys = ssh_public_keys;
        if (unprivileged !== undefined)
            params.unprivileged = unprivileged ? "1" : "0";
        if (description)
            params.description = description;
        const result = await makeRequest("post", `/nodes/${node}/lxc`, params);
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({ success: true, vmid: result.vmid }, null, 2),
                },
            ],
        };
    }
    catch (error) {
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
});
// ==================== Deletion Tools ====================
// Delete VM
server.registerTool("delete_vm", {
    description: "Delete a VM from Proxmox",
    inputSchema: {
        node: z.string().describe("Node where VM is located"),
        vmid: z.number().describe("VM ID to delete"),
        force: z.boolean().optional().describe("Force delete (removes VM even if in use)"),
    },
}, async ({ node, vmid, force }) => {
    try {
        const params = {};
        if (force)
            params.force = "1";
        await makeRequest("delete", `/nodes/${node}/qemu/${vmid}`, params);
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({ success: true, message: `VM ${vmid} deleted successfully` }, null, 2),
                },
            ],
        };
    }
    catch (error) {
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
});
// Delete Container
server.registerTool("delete_container", {
    description: "Delete a container from Proxmox",
    inputSchema: {
        node: z.string().describe("Node where container is located"),
        vmid: z.number().describe("Container ID to delete"),
        force: z.boolean().optional().describe("Force delete"),
    },
}, async ({ node, vmid, force }) => {
    try {
        const params = {};
        if (force)
            params.force = "1";
        await makeRequest("delete", `/nodes/${node}/lxc/${vmid}`, params);
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({ success: true, message: `Container ${vmid} deleted successfully` }, null, 2),
                },
            ],
        };
    }
    catch (error) {
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
});
// ==================== Console Access Tool ====================
// Access VM console
server.registerTool("vm_console", {
    description: "Access VM console",
    inputSchema: {
        node: z.string().describe("Node where VM is located"),
        vmid: z.number().describe("VM ID"),
        type: z.enum(["serial", "websocket"]).optional().describe("Console type"),
    },
}, async ({ node, vmid, type = "websocket" }) => {
    try {
        const result = await makeRequest("post", `/nodes/${node}/qemu/${vmid}/console`, { type });
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(result.data, null, 2),
                },
            ],
        };
    }
    catch (error) {
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
});
// ==================== Maintenance Tools ====================
// Get Proxmox VE version
server.registerTool("get_proxmox_version", {
    description: "Get Proxmox VE version",
}, async () => {
    try {
        const status = await makeRequest("get", "/version");
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(status, null, 2),
                },
            ],
        };
    }
    catch (error) {
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
});
// Get available updates
server.registerTool("get_updates", {
    description: "Get available updates for Proxmox",
    inputSchema: {
        node: z.string().optional().describe("Node name (optional)"),
    },
}, async ({ node }) => {
    try {
        const endpoint = node ? `/nodes/${node}/apt/update` : "/apt/update";
        const result = await makeRequest("get", endpoint);
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(result.data, null, 2),
                },
            ],
        };
    }
    catch (error) {
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
});
// Upgrade Proxmox VE
server.registerTool("upgrade_proxmox", {
    description: "Upgrade Proxmox VE",
    inputSchema: {
        node: z.string().describe("Node to upgrade"),
        dist_upgrade: z.boolean().optional().describe("Perform distribution upgrade"),
    },
}, async ({ node, dist_upgrade }) => {
    try {
        const params = {};
        if (dist_upgrade)
            params.dist_upgrade = "1";
        const result = await makeRequest("post", `/nodes/${node}/apt/upgrade`, params);
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({ success: true, taskid: result.taskid }, null, 2),
                },
            ],
        };
    }
    catch (error) {
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
});
// Get task status
server.registerTool("get_task_status", {
    description: "Get status of a running task",
    inputSchema: {
        node: z.string().describe("Node where task is running"),
        taskid: z.string().describe("Task ID"),
    },
}, async ({ node, taskid }) => {
    try {
        const status = await makeRequest("get", `/nodes/${node}/tasks/${taskid}`);
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(status, null, 2),
                },
            ],
        };
    }
    catch (error) {
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
});
// Start VM
server.registerTool("start_vm", {
    description: "Start a VM",
    inputSchema: {
        node: z.string().describe("Node where VM is located"),
        vmid: z.number().describe("VM ID to start"),
    },
}, async ({ node, vmid }) => {
    try {
        await makeRequest("post", `/nodes/${node}/qemu/${vmid}/status/start`);
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({ success: true, message: `VM ${vmid} started` }, null, 2),
                },
            ],
        };
    }
    catch (error) {
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
});
// Stop VM
server.registerTool("stop_vm", {
    description: "Stop a VM",
    inputSchema: {
        node: z.string().describe("Node where VM is located"),
        vmid: z.number().describe("VM ID to stop"),
        timeout: z.number().optional().describe("Timeout in seconds before force shutdown"),
    },
}, async ({ node, vmid, timeout }) => {
    try {
        const params = {};
        if (timeout)
            params.timeout = timeout.toString();
        await makeRequest("post", `/nodes/${node}/qemu/${vmid}/status/stop`, params);
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({ success: true, message: `VM ${vmid} stopped` }, null, 2),
                },
            ],
        };
    }
    catch (error) {
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
});
// Shutdown VM
server.registerTool("shutdown_vm", {
    description: "Shutdown a VM gracefully",
    inputSchema: {
        node: z.string().describe("Node where VM is located"),
        vmid: z.number().describe("VM ID to shutdown"),
        timeout: z.number().optional().describe("Timeout in seconds before force shutdown"),
    },
}, async ({ node, vmid, timeout }) => {
    try {
        const params = {};
        if (timeout)
            params.timeout = timeout.toString();
        await makeRequest("post", `/nodes/${node}/qemu/${vmid}/status/shutdown`, params);
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({ success: true, message: `VM ${vmid} shutdown initiated` }, null, 2),
                },
            ],
        };
    }
    catch (error) {
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
});
// Restart VM
server.registerTool("restart_vm", {
    description: "Restart a VM",
    inputSchema: {
        node: z.string().describe("Node where VM is located"),
        vmid: z.number().describe("VM ID to restart"),
    },
}, async ({ node, vmid }) => {
    try {
        await makeRequest("post", `/nodes/${node}/qemu/${vmid}/status/reboot`);
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({ success: true, message: `VM ${vmid} restarted` }, null, 2),
                },
            ],
        };
    }
    catch (error) {
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
});
// Start Container
server.registerTool("start_container", {
    description: "Start a container",
    inputSchema: {
        node: z.string().describe("Node where container is located"),
        vmid: z.number().describe("Container ID to start"),
    },
}, async ({ node, vmid }) => {
    try {
        await makeRequest("post", `/nodes/${node}/lxc/${vmid}/status/start`);
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({ success: true, message: `Container ${vmid} started` }, null, 2),
                },
            ],
        };
    }
    catch (error) {
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
});
// Stop Container
server.registerTool("stop_container", {
    description: "Stop a container",
    inputSchema: {
        node: z.string().describe("Node where container is located"),
        vmid: z.number().describe("Container ID to stop"),
        timeout: z.number().optional().describe("Timeout in seconds before force shutdown"),
    },
}, async ({ node, vmid, timeout }) => {
    try {
        const params = {};
        if (timeout)
            params.timeout = timeout.toString();
        await makeRequest("post", `/nodes/${node}/lxc/${vmid}/status/stop`, params);
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({ success: true, message: `Container ${vmid} stopped` }, null, 2),
                },
            ],
        };
    }
    catch (error) {
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
});
// Shutdown Container
server.registerTool("shutdown_container", {
    description: "Shutdown a container gracefully",
    inputSchema: {
        node: z.string().describe("Node where container is located"),
        vmid: z.number().describe("Container ID to shutdown"),
        timeout: z.number().optional().describe("Timeout in seconds before force shutdown"),
    },
}, async ({ node, vmid, timeout }) => {
    try {
        const params = {};
        if (timeout)
            params.timeout = timeout.toString();
        await makeRequest("post", `/nodes/${node}/lxc/${vmid}/status/shutdown`, params);
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({ success: true, message: `Container ${vmid} shutdown initiated` }, null, 2),
                },
            ],
        };
    }
    catch (error) {
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
});
// Restart Container
server.registerTool("restart_container", {
    description: "Restart a container",
    inputSchema: {
        node: z.string().describe("Node where container is located"),
        vmid: z.number().describe("Container ID to restart"),
    },
}, async ({ node, vmid }) => {
    try {
        await makeRequest("post", `/nodes/${node}/lxc/${vmid}/status/reboot`);
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({ success: true, message: `Container ${vmid} restarted` }, null, 2),
                },
            ],
        };
    }
    catch (error) {
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
});
// Get all running VMs and containers on a node
server.registerTool("get_running_vms", {
    description: "Get all running VMs and containers on a node",
    inputSchema: {
        node: z.string().describe("Node name"),
    },
}, async ({ node }) => {
    try {
        const vms = await makeRequest("get", `/nodes/${node}/qemu`);
        const containers = await makeRequest("get", `/nodes/${node}/lxc`);
        const runningVms = vms.filter((vm) => vm.status === "running");
        const runningContainers = containers.filter((c) => c.status === "running");
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({
                        running_vms: runningVms,
                        running_containers: runningContainers,
                        total_running: runningVms.length + runningContainers.length,
                    }, null, 2),
                },
            ],
        };
    }
    catch (error) {
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
});
// ==================== Start Server ====================
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("Proxmox MCP server running on stdio");
//# sourceMappingURL=index.js.map