class SSEService {
  constructor() {
    this.connections = new Map();
  }

  addConnection(category, res) {
    if (!this.connections.has(category)) {
      this.connections.set(category, new Map());
    }
    const clientId = `client_${Date.now()}_${Math.random()}`;
    this.connections.get(category).set(clientId, res);
    return clientId;
  }

  removeConnection(category, clientId) {
    if (this.connections.has(category)) {
      this.connections.get(category).delete(clientId);
      if (this.connections.get(category).size === 0) {
        this.connections.delete(category);
      }
    }
  }

  broadcastPOIUpdates(category, newPOIs, polygon) {
    if (!this.connections.has(category) || newPOIs.length === 0) return;
    const clients = this.connections.get(category);
    const updateData = {
      type: "poi_update",
      category,
      pois: newPOIs,
      count: newPOIs.length,
      timestamp: Date.now(),
      polygon_hash: require("crypto")
        .createHash("sha256")
        .update(JSON.stringify(polygon))
        .digest("hex"),
    };
    clients.forEach((res, clientId) => {
      try {
        res.write(`data: ${JSON.stringify(updateData)}\n\n`);
      } catch (error) {
        this.removeConnection(category, clientId);
      }
    });
  }
}

module.exports = new SSEService();
