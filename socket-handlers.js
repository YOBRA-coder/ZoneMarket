// backend/socket-handlers.js
// Attach all real-time location handlers to the Socket.IO server

module.exports = function attachSocketHandlers(io) {

  // Track which socket belongs to which user
  const userSockets = new Map(); // userId -> socketId
  const socketUsers = new Map(); // socketId -> userId

  io.on('connection', (socket) => {

    // ─── Join room (userId) ────────────────────────────────────────
    socket.on('join', (userId) => {
      if (!userId) return;
      socket.join(userId);
      socket.join('admin-room'); // admins subscribe separately
      userSockets.set(userId, socket.id);
      socketUsers.set(socket.id, userId);
    });

    // ─── Live location update from any user (background task posts here) ──
    socket.on('location_update', async (data) => {
      // data: { userId, role, name, zoneId, zoneName, lat, lng, accuracy, speed, heading, timestamp }
      if (!data.userId || !data.lat || !data.lng) return;

      // Broadcast to admin room so admin live map sees all movements
      socket.to('admin-room').emit('location_update', data);

      // Also broadcast back to the user's own socket as ack
      socket.emit('my_location_ack', { lat: data.lat, lng: data.lng, heading: data.heading });
    });

    // ─── Rider location during active order delivery ───────────────
    socket.on('rider_location', async (data) => {
      // data: { orderId, managerId, lat, lng, heading, timestamp }
      if (!data.orderId) return;

      // Broadcast to:
      //   1. The order room (client watching this order)
      //   2. The admin room
      io.to(`order-${data.orderId}`).emit('rider_location', data);
      socket.to('admin-room').emit('rider_location', data);
    });

    // ─── Client watches a specific order ──────────────────────────
    socket.on('watch_order', ({ orderId }) => {
      if (orderId) socket.join(`order-${orderId}`);
    });

    socket.on('unwatch_order', ({ orderId }) => {
      if (orderId) socket.leave(`order-${orderId}`);
    });

    // ─── Admin subscribes to all location events ──────────────────
    socket.on('join_admin', () => {
      socket.join('admin-room');
    });

    // ─── Order status updates ─────────────────────────────────────
    socket.on('order_status_change', ({ orderId, status, clientId }) => {
      // Notify the client
      if (clientId) io.to(clientId).emit('order_update', { orderId, status });
      // Notify admin
      io.to('admin-room').emit('order_update', { orderId, status });
    });

    // ─── New order notification to manager ────────────────────────
    socket.on('notify_manager', ({ managerId, orderId, reference, total }) => {
      io.to(managerId).emit('new_order', { orderId, reference, total });
    });

    // ─── Cleanup on disconnect ────────────────────────────────────
    socket.on('disconnect', () => {
      const userId = socketUsers.get(socket.id);
      if (userId) {
        userSockets.delete(userId);
        // Notify admin that user went offline
        socket.to('admin-room').emit('user_offline', { userId });
      }
      socketUsers.delete(socket.id);
    });
  });

  return { userSockets, socketUsers };
};
