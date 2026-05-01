// backend/pushNotifications.js
// Sends push notifications via Expo Push API to Android & iOS
// No FCM/APNs setup needed — Expo handles it all

const axios = require('axios');

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/**
 * Send push notification to one or more Expo push tokens
 * @param {string|string[]} tokens - Expo push token(s)
 * @param {string} title
 * @param {string} body
 * @param {object} data - extra data for navigation on tap
 * @param {string} channelId - Android notification channel
 */
async function sendPushNotification(tokens, title, body, data = {}, channelId = 'general') {
  const tokenList = Array.isArray(tokens) ? tokens : [tokens];

  // Filter valid Expo tokens only
  const validTokens = tokenList.filter(t => t && t.startsWith('ExponentPushToken['));
  if (!validTokens.length) return;

  // Expo Push API accepts up to 100 messages per request
  const messages = validTokens.map(token => ({
    to:           token,
    title,
    body,
    data,
    sound:        'default',
    badge:        1,
    channelId,                          // Android channel
    priority:     'high',               // Android FCM priority
    ttl:          3600,                 // seconds to keep if device offline
    expiration:   Math.floor(Date.now() / 1000) + 3600,
    mutableContent: true,               // iOS rich notifications
    categoryIdentifier: channelId,
    android: {
      channelId,
      color:        '#FF6B2C',
      smallIcon:    'ic_notification',
      priority:     'high',
      vibrationPattern: [0, 250, 250, 250],
    },
  }));

  try {
    // Split into chunks of 100
    const chunks = [];
    for (let i = 0; i < messages.length; i += 100) {
      chunks.push(messages.slice(i, i + 100));
    }

    const results = await Promise.all(
      chunks.map(chunk =>
        axios.post(EXPO_PUSH_URL, chunk, {
          headers: {
            'Accept':       'application/json',
            'Content-Type': 'application/json',
          },
        })
      )
    );

    results.forEach(r => {
      const { data: resData } = r;
      if (resData?.data) {
        resData.data.forEach((ticket, idx) => {
          if (ticket.status === 'error') {
            console.warn(`Push failed for token ${validTokens[idx]}:`, ticket.message);
          }
        });
      }
    });
  } catch (err) {
    console.error('Expo Push API error:', err.message);
  }
}

// ─── Notification templates ────────────────────────────────────────────────────

module.exports = {
  sendPushNotification,

  // Manager: new order arrived
  notifyManagerNewOrder: (pushToken, reference, total, orderId) =>
    sendPushNotification(
      pushToken,
      '🛍️ New Order!',
      `Order #${reference} · KSh ${total} — Tap to view`,
      { type: 'new_order', orderId, reference },
      'orders'
    ),

  // Client: order confirmed by manager
  notifyClientOrderConfirmed: (pushToken, reference, orderId) =>
    sendPushNotification(
      pushToken,
      '✅ Order Confirmed',
      `Your order #${reference} is confirmed and being prepared.`,
      { type: 'order_confirmed', orderId, reference },
      'orders'
    ),

  // Client: order dispatched (rider heading over)
  notifyClientOrderDispatched: (pushToken, reference, riderName, orderId) =>
    sendPushNotification(
      pushToken,
      '🚲 On the Way!',
      `${riderName} is delivering order #${reference}. Tap to track live!`,
      { type: 'order_dispatched', orderId, reference },
      'orders'
    ),

  // Client: order delivered
  notifyClientOrderDelivered: (pushToken, reference, orderId) =>
    sendPushNotification(
      pushToken,
      '🎉 Delivered!',
      `Order #${reference} delivered. Enjoy your items!`,
      { type: 'order_delivered', orderId, reference },
      'orders'
    ),

  // Client: order cancelled
  notifyClientOrderCancelled: (pushToken, reference, reason, orderId) =>
    sendPushNotification(
      pushToken,
      '❌ Order Cancelled',
      `Order #${reference} was cancelled. ${reason || ''}`,
      { type: 'order_cancelled', orderId, reference },
      'orders'
    ),

  // Client/Manager: M-Pesa deposit confirmed
  notifyDepositConfirmed: (pushToken, amount) =>
    sendPushNotification(
      pushToken,
      '💰 Deposit Confirmed',
      `KSh ${amount.toLocaleString()} added to your wallet via M-Pesa.`,
      { type: 'payment', amount },
      'payments'
    ),

  // Manager: earnings credited after delivery
  notifyManagerEarningsCredited: (pushToken, amount, reference) =>
    sendPushNotification(
      pushToken,
      '💵 Earnings Credited!',
      `KSh ${amount.toLocaleString()} earned from order #${reference}.`,
      { type: 'earning', amount, reference },
      'payments'
    ),

  // Admin: commission credited
  notifyAdminCommission: (pushToken, amount, reference) =>
    sendPushNotification(
      pushToken,
      '📈 Commission Earned',
      `KSh ${amount.toLocaleString()} commission from order #${reference}.`,
      { type: 'commission', amount, reference },
      'payments'
    ),

  // Client: zone change
  notifyZoneChange: (pushToken, fromZone, toZone) =>
    sendPushNotification(
      pushToken,
      '📍 Zone Updated',
      `You moved from ${fromZone} → ${toZone}. Managers refreshed.`,
      { type: 'zone_change' },
      'general'
    ),

  // Broadcast promo to all clients in a zone
  broadcastPromo: (pushTokens, productName, discount, zoneId) =>
    sendPushNotification(
      pushTokens,
      '🎁 Limited Offer in Your Zone!',
      `${productName} is ${discount}% OFF now. Hurry!`,
      { type: 'promo', zoneId },
      'general'
    ),

    // Client/Manager: M-Pesa deposit confirmed
  notifyClientPaymentSuccess: (pushToken, reference,amount) =>
    sendPushNotification(
      pushToken,
      '💰 Order Payment Confirmed',
      `KSh ${amount.toLocaleString()} Paid receive for your order #${reference}.`,
      { type: 'payment', amount },
      'payments'
    ),  
};
