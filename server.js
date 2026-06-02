// backend/server.js - ZoneMarket API Server
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const http = require('http');
const axios = require('axios');
const { Server } = require('socket.io');
const push = require('./pushNotifications');
require('dotenv').config();
const { router: paymentsRouter } = require('./payments');
const { router: extrasRouter } = require('./extras');
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });


app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

async function start() {
  try {
    await mongoose.connect('mongodb://127.0.0.1:27017/myZone?directConnection=true')
    console.log("db connected insert");
    const hashed = await bcrypt.hash("demo1234", 12);
    const admin = new User({
      name: "Demo Client",
      email: "demo@zonemarket.com",
      password: hashed,
      phone: "0748175477",
      role: "client"
    });
    await admin.save()
    console.log("admin created");
    process.exit(0)

  } catch (err) {
    console.error("failed", err)

  }
}


// ── M-PESA CONFIG ────────────────────────────────────────────────────
const MPESA_BASE = 'https://sandbox.safaricom.co.ke'; // change to api.safaricom.co.ke for production
const MPESA_CONSUMER_KEY = process.env.MPESA_CONSUMER_KEY || '';
const MPESA_CONSUMER_SEC = process.env.MPESA_CONSUMER_SECRET || '';
const MPESA_SHORTCODE = process.env.MPESA_SHORTCODE || '174379';
const MPESA_PASSKEY = process.env.MPESA_PASSKEY || '';
const MPESA_CALLBACK_URL = process.env.MPESA_CALLBACK_URL || 'https://your-domain.com/api/v1/wallet/mpesa/callback';

mongoose.connect(process.env.MONGO_URI)
//mongodb://127.0.0.1:27017/zonemarket?directConnection=true
// ─── MODELS ─────────────────────────────────────────────────────────

const UserSchema = new mongoose.Schema({
  userName: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  phone: { type: String },
  role: { type: String, enum: ['admin', 'manager', 'client'], required: true },
  zoneId: { type: mongoose.Schema.Types.ObjectId, ref: 'Zone' },
  walletBalance: { type: Number, default: 0 },
  adminCommission: { type: Number, default: 0 }, // admin only
  totalEarnings: { type: Number, default: 0 },
  currentLocation: { lat: Number, lng: Number, updatedAt: Date },
  isActive: { type: Boolean, default: true },
  isManagerVerified: { type: Boolean, default: false }, // for managers
  isAdminVerified: { type: Boolean, default: false }, // for admins created by other admins
  isVerified: { type: Boolean, default: false },
  isRegistered: { type: Boolean, default: false },
  pushToken: String,
  managerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  avatar: String,
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // manager created by admin
}, { timestamps: true });

const ZoneSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: String,
  center: { lat: Number, lng: Number },
  radius: { type: Number, default: 5000 }, // meters
  isActive: { type: Boolean, default: true },
  adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

const CategorySchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: String,
  label: { type: String, required: true },
  icon: { type: String, required: true },
  isActive: { type: Boolean, default: true },
  managerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  zoneId: { type: mongoose.Schema.Types.ObjectId, ref: 'Zone' },
}, { timestamps: true });

const NotificationSchema = new mongoose.Schema({
  title: { type: String, required: true },
  body: { type: String, required: true },
  type: { type: String, required: true },
  recipients: [{
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    isRead: { type: Boolean, default: false },
    readAt: Date
  }],
  recipientRole: [{ type: String, enum: ['admin', 'manager', 'client'] }],
  createdAt: { type: Date, default: Date.now }
}, { timestamps: true });

const ProductSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: String,
  price: { type: Number, required: true },
  originalPrice: Number,
  discount: Number,
  stock: { type: Number, default: 0 },
  category: { type: String },
  categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category' },
  images: [String],
  managerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  zoneId: { type: mongoose.Schema.Types.ObjectId, ref: 'Zone' },
  likes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  isLatest: { type: Boolean, default: true },
  isHot: { type: Boolean, default: false },
  hasPromotion: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },
  isHidden: { type: Boolean, default: false }, // for soft delete or seasonal products
  hasVariants: { type: Boolean, default: false }, // Kama ni TRUE, app itasoma bei kutoka kwenye list ya chini, sio ile ya juu
  variants: [VariantSchema]
}, { timestamps: true });

const VariantSchema = new mongoose.Schema({
  formatType: { type: String, required: true,  enum: ['grams', 'blunts'] // Inaruhusu 'grams' au 'blunts' pekee
  },
  measurementLabel: { type: String, required: true // Mfano: "1 Gram", "3 Grams", "1 Pre-Roll Blunt"
  },
  price: { type: Number, required: true },
  originalPrice: Number, // Ili uweze kuweka discount hadi kwenye kiwango cha variant
  stock: { ype: Number, default: 0 }
});

const OrderSchema = new mongoose.Schema({
  reference: { type: String, unique: true },
  clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  managerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  zoneId: { type: mongoose.Schema.Types.ObjectId, ref: 'Zone' },
  items: [{
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    name: String, price: Number, quantity: Number,
  }],
  subtotal: Number,
  deliveryFee: { type: Number, default: 50 },
  total: Number,
  adminCommission: Number, // % of total goes to admin
  managerEarning: Number, // remainder to manager
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'dispatched', 'delivered', 'cancelled'],
    default: 'pending',
  },
  paymentMethod: { type: String, enum: ['wallet', 'mpesa', 'cash', 'bank'] },
  paymentStatus: { type: String, enum: ['pending', 'paid', 'failed'], default: 'pending' },
  deliveryLocation: { lat: Number, lng: Number, address: String },
  trackingUpdates: [{ status: String, time: Date, note: String }],
  estimatedDelivery: Date,
  deliveredAt: Date,
  cancelReason: String,
}, { timestamps: true });

const TransactionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, enum: ['deposit', 'withdrawal', 'order_payment', 'commission', 'earning'] },
  amount: Number,
  balance: Number,
  reference: String,
  description: String,
  status: { type: String, enum: ['pending', 'completed', 'failed'], default: 'pending' },
  method: { type: String, enum: ['wallet', 'mpesa', 'bank', 'cash'] },
  mpesaRef: String,
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
}, { timestamps: true });

const CommentSchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  userName:  String,
  text:      { type: String, required: true },
  editedAt:  Date,
}, { timestamps: true });


const User = mongoose.model('User', UserSchema);
const Zone = mongoose.model('Zone', ZoneSchema);
const Product = mongoose.model('Product', ProductSchema);
const Order = mongoose.model('Order', OrderSchema);
const Transaction = mongoose.model('Transaction', TransactionSchema);
const Comment = mongoose.model('Comment', CommentSchema);
const Notification = mongoose.model('Notification', NotificationSchema);
const Category = mongoose.model('Category', CategorySchema);

// ─── MIDDLEWARE ──────────────────────────────────────────────────────

const auth = (roles = []) => async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'No token' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'zonemarket_secret_2024');
    req.user = await User.findById(decoded.id).select('-password');
    if (!req.user) return res.status(401).json({ message: 'User not found' });
    if (roles.length && !roles.includes(req.user.role)) return res.status(403).json({ message: 'Forbidden' });
    next();
  } catch { res.status(401).json({ message: 'Invalid token' }); }
};

const ADMIN_COMMISSION_RATE = 0.05; // 5% commission on each sale



// ═══════════════════════════════════════════════════════════════════
//  M-PESA HELPERS
// ═══════════════════════════════════════════════════════════════════

async function getMpesaToken() {
  const creds = Buffer.from(`${MPESA_CONSUMER_KEY}:${MPESA_CONSUMER_SEC}`).toString('base64');
  const res = await axios.get(`${MPESA_BASE}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${creds}` }
  });
  return res.data.access_token;
}

async function initiateStkPush(phone, amount, orderId) {
  const token = await getMpesaToken();
  const timestamp = new Date().toISOString().replace(/[-T:Z.]/g, '').slice(0, 14);
  const password = Buffer.from(`${MPESA_SHORTCODE}${MPESA_PASSKEY}${timestamp}`).toString('base64');

  // Format phone: 0712345678 → 254712345678
  const formattedPhone = phone.startsWith('0') ? `254${phone.slice(1)}` : phone;

  const res = await axios.post(`${MPESA_BASE}/mpesa/stkpush/v1/processrequest`, {
    BusinessShortCode: MPESA_SHORTCODE,
    Password: password,
    Timestamp: timestamp,
    TransactionType: 'CustomerPayBillOnline',
    Amount: Math.ceil(amount),
    PartyA: formattedPhone,
    PartyB: MPESA_SHORTCODE,
    PhoneNumber: formattedPhone,
    CallBackURL: MPESA_CALLBACK_URL,
    AccountReference: `ZM-${orderId || 'DEPOSIT'}`,
    TransactionDesc: 'ZoneMarket Payment',
  }, { headers: { Authorization: `Bearer ${token}` } });
  return res.data;
}

// ── Auth (login, register, OTP, referral) ──────────────────────────────────
const { router: authRouter, buildUserPayload } = require('./auth');
app.use('/api/v1/auth', authRouter);

app.get('/api/v1/auth/profile', auth(), async (req, res) => {
  res.json(req.user);
});

app.put('/api/v1/auth/profile', auth(), async (req, res) => {
  const allowed = ['name', 'phone', 'avatar'];
  const updates = {};
  allowed.forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });
  const user = await User.findByIdAndUpdate(req.user._id, updates, { new: true }).select('-password');
  res.json(user);
});
// ─── ZONES ───────────────────────────────────────────────────────────

app.get('/api/v1/zones', async (req, res) => {
  const zones = await Zone.find({ isActive: true });
  res.json(zones);
});

app.post('/api/v1/zones', auth(['admin']), async (req, res) => {
  const zone = await Zone.create({ ...req.body, adminId: req.user._id });
  res.status(201).json(zone);
});

app.put('/api/v1/zones/:id', auth(['admin']), async (req, res) => {
  res.json(await Zone.findByIdAndUpdate(req.params.id, req.body, { new: true }));
});

app.get('/api/v1/zones/nearby', auth(), async (req, res) => {
  const { lat, lng } = req.query;
  // Return all zones for now; in production use geo queries
  const zones = await Zone.find({ isActive: true });
  res.json(zones);
});

// User changes zone (location tracking)
app.post('/api/v1/zones/user/:userId/update-location', auth(), async (req, res) => {
  const { lat, lng, zoneId } = req.body;
  await User.findByIdAndUpdate(req.params.userId, {
    currentLocation: { lat, lng, updatedAt: new Date() },
    zoneId,
  });
  io.emit('location_change', { userId: req.params.userId, lat, lng, zoneId, time: new Date() });
  res.json({ success: true });
});

app.delete('/api/v1/zones/:id', auth(['manager', 'admin']), async (req, res) => {
  await Zone.findByIdAndDelete(req.params.id);
  res.json({ success: true });
});

app.post("/api/v1/admin/approve", async (req, res) => {
  const { phone } = req.body;

  const code = generateReferralCode();
  const expiry = new Date(Date.now() + 3 * 60 * 60 * 1000); // 3 hrs

  const user = await User.findOneAndUpdate(
    { phone },
    {
      referralCode: code,
      referralExpiresAt: expiry,
      isApproved: true
    },
    { upsert: true, new: true }
  );
  // send SMS here
  await sendSMS(phone, `Your referral code is ${code}`);

  res.json({ message: "Approved & code sent" });
});
// ------------- CATEGORIES--------------------------------------------

app.get('/api/v1/categories', auth(), async (req, res) => {
  const filter = { isActive: true };
  if (req.query.zoneId) filter.zoneId = req.query.zoneId;
  const categories = await Category.find(filter).sort({ createdAt: -1 });
  res.json({ categories: categories.map(p => ({ ...p.toObject(), itemCount: p.length || 0 })) });
});

app.get('/api/v1/categories/:id', auth(), async (req, res) => {
  const c = await Category.findById(req.params.id).populate('managerId', 'name').populate('zoneId', 'name');
  if (!c) return res.status(404).json({ message: 'Category not found' });
  res.json({ ...c.toObject(), managerName: c.managerId?.name, zoneName: c.zoneId?.name });
});

app.post('/api/v1/categories', auth(['manager']), async (req, res) => {
  const category = await Category.create({ ...req.body, managerId: req.user._id, zoneId: req.user.zoneId });
  res.status(201).json(category);
});
// ─── PRODUCTS ────────────────────────────────────────────────────────

app.get('/api/v1/products', auth(), async (req, res) => {
  const filter = { isActive: true };
  if (req.query.zoneId) filter.zoneId = req.query.zoneId;
  if (req.query.category && req.query.category !== 'all') filter.category = req.query.category;
  const products = await Product.find(filter).sort({ createdAt: -1 });
  const userId = req.user._id;
  res.json({ products: products.map(p => ({ ...p.toObject(), liked: p.likes.includes(userId), likesCount: p.likes.length })) });
});

app.get('/api/v1/products/:id', auth(), async (req, res) => {
  const p = await Product.findById(req.params.id).populate('managerId', 'name').populate('zoneId', 'name');
  if (!p) return res.status(404).json({ message: 'Product not found' });
  res.json({ ...p.toObject(), liked: p.likes.some(id => id.equals(req.user._id)), likesCount: p.likes.length, managerName: p.managerId?.name, zoneName: p.zoneId?.name });
});

app.post('/api/v1/products', auth(['manager', 'admin']), async (req, res) => {
  console.log(req.body);
  const product = await Product.create({ ...req.body, managerId: req.user._id, zoneId: req.user.zoneId });
  res.status(201).json(product);
});

app.put('/api/v1/products/:id', auth(['manager', 'admin']), async (req, res) => {
  const product = await Product.findByIdAndUpdate(req.params.id, req.body, { new: true });
  res.json(product);
});

app.delete('/api/v1/products/:id', auth(['manager', 'admin']), async (req, res) => {
  await Product.findByIdAndUpdate(req.params.id, { isActive: false });
  res.json({ success: true });
});

app.post('/api/v1/products/:id/restock', auth(['manager', 'admin']), async (req, res) => {
  const product = await Product.findByIdAndUpdate(req.params.id, { $inc: { stock: req.body.quantity } }, { new: true });
  res.json(product);
});

app.post('/api/v1/products/:id/like', auth(), async (req, res) => {
  const product = await Product.findById(req.params.id);
  const liked = product.likes.includes(req.user._id);
  if (liked) product.likes.pull(req.user._id);
  else product.likes.push(req.user._id);
  await product.save();
  res.json({ liked: !liked, likesCount: product.likes.length });
});

app.get('/api/v1/products/:id/comments', auth(), async (req, res) => {
  const comments = await Comment.find({ productId: req.params.id }).populate('userId', 'name avatar').sort({ createdAt: -1 });
  res.json(comments);
});

app.post('/api/v1/products/:id/comments', auth(), async (req, res) => {
  const comment = await Comment.create({ productId: req.params.id, userId: req.user._id, text: req.body.text });
  res.status(201).json(comment);
});

// ─── ORDERS ──────────────────────────────────────────────────────────

app.post('/api/v1/orders', auth(['client']), async (req, res) => {
  const { items, deliveryLocation, paymentMethod } = req.body;
  const subtotal = items.reduce((s, i) => s + i.price * i.quantity, 0);
  const deliveryFee = 50;
  const total = subtotal + deliveryFee;
  const adminCommission = total * ADMIN_COMMISSION_RATE;
  const managerEarning = total - adminCommission;
  const reference = 'ORD' + Date.now();

  // Find manager for this zone
  const manager = await User.findOne({ role: 'manager', zoneId: req.user.zoneId, isActive: true });

  // Find if any pending orders for this client
  const pendingOrder = await Order.findOne({ clientId: req.user._id, status: 'pending' });
  if (pendingOrder) {
    return res.status(400).json({ message: 'You have a pending order' });
  }


  const order = await Order.create({
    reference, clientId: req.user._id, managerId: manager?._id,
    zoneId: req.user.zoneId, items, subtotal, deliveryFee, total,
    adminCommission, managerEarning, paymentMethod, deliveryLocation,
    estimatedDelivery: new Date(Date.now() + 35 * 60000),
    trackingUpdates: [{ status: 'pending', time: new Date(), note: 'Order placed' }],
  });


  const newNotification = new Notification({
    title: "New Order Received",
    type: 'new_order',
    body: 'Items ' + order.items.map(i => i.name).join(', ') + ' Total + Delivery ' + order.total + '',
    recipients: [
      { user: req.user_id, isRead: false },
      { user: manager?._id, isRead: false }
    ],
    recipientRole: ["client", "manager", "admin"],
  });
  await newNotification.save();
  // Notify manager
  if (manager) {
    io.to(manager._id.toString()).emit('new_order', { orderId: order._id, reference, total });
    if (manager.pushToken) push.notifyManagerNewOrder(manager.pushToken, reference, total, order._id.toString());
  }
  res.status(201).json({ orderId: order._id, reference, estimatedDelivery: order.estimatedDelivery });
});

app.get('/api/v1/orders/:id', auth(), async (req, res) => {
  const order = await Order.findById(req.params.id)
    .populate('clientId', 'name phone')
    .populate('managerId', 'name phone');
  if (!order) return res.status(404).json({ message: 'Order not found' });
  res.json({ ...order.toObject(), clientName: order.clientId?.name, clientPhone: order.clientId?.phone });
});

app.get('/api/v1/orders/manager/:managerId', auth(['manager', 'admin']), async (req, res) => {
  const orders = await Order.find({ managerId: req.params.managerId }).sort({ createdAt: -1 }).populate('clientId', 'name phone');
  res.json({ orders: orders.map(o => ({ ...o.toObject(), clientName: o.clientId?.name, itemCount: o.items?.length || 0, timeAgo: getTimeAgo(o.createdAt) })) });
});

app.get('/api/v1/orders/client/:clientId', auth(), async (req, res) => {
  const orders = await Order.find({ clientId: req.params.clientId }).sort({ createdAt: -1 });
  res.json({ orders: orders.map(o => ({ ...o.toObject(), itemCount: o.items?.length || 0 })) });
});

app.put('/api/v1/orders/:id/cancel', auth(), async (req,res) => {
  const order = (await Order.findById({_id: req.params.id }));
  if(!order) res.status(404).json({message: "Order not found"});
  const newOrder = await Order.findByIdAndUpdate({_id: req.params.id}, {status: "cancelled", cancelReason: req.body.reason, $push: {trackingUpdates: {status: "cancelled", time: new Date(), note: req.body.reason}}}, {new: true});   
  console.log('order cancelled success'+newOrder);
  return res.json({success: true, newOrder})
})
app.get('/api/v1/orders/top-products/:zoneId', auth(['manager', 'admin']), async (req, res) => {
  try{
  const topProducts = await Order.aggregate([
  { $match: { status: 'delivered' } }, // only completed orders
  { $unwind: '$items' }, // break items array
  {
    $group: {
      _id: '$items.productId',
      name: { $first: '$items.name' },
      totalSold: { $sum: '$items.quantity' },
      totalRevenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } }
    }
  },
  { $sort: { totalSold: -1 } }, // most sold first
  { $limit: 10 } // top 10 products
]); 
 res.json({ products: topProducts });
}catch(err){
  console.error("Error fetching top products:", err);
  res.status(500).json({ message: 'Failed to fetch top products' });
}
});

app.get('/api/v1/orders/weekly-stats/:zoneId', auth(['manager', 'admin']), async (req, res) => {
  try{
const startOfWeek = new Date();
startOfWeek.setHours(0, 0, 0, 0);

// Set to Monday (or Sunday depending on your logic)
const day = startOfWeek.getDay(); // 0 (Sun) - 6 (Sat)
const diff = startOfWeek.getDate() - day + (day === 0 ? -6 : 1);
startOfWeek.setDate(diff);

const endOfWeek = new Date(startOfWeek);
endOfWeek.setDate(startOfWeek.getDate() + 7);

const weeklyStats = await Order.aggregate([
  {
    $match: {
      status: 'delivered', // or 'paid' depending on your logic
      createdAt: {
        $gte: startOfWeek,
        $lt: endOfWeek
      }
    }
  },
  {
    $group: {
      _id: {
        $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: "Africa/Nairobi" }
      },
      orderCount: { $sum: 1 },
      dailyRevenue: { $sum: "$total" }
    }
  },
  { $sort: { _id: 1 } }
]);
console.log(`Weekly stats: ${weeklyStats.length}`);
 res.json({ stats: weeklyStats });
}catch(err){
  console.error("Error fetching weekly stats:", err);
  console.log("Start of week:", startOfWeek, "End of week:", endOfWeek);
  res.status(500).json({ message: 'Failed to fetch weekly stats' });
}
});

app.get('/api/v1/orders/monthly-stats/:zoneId', auth(['manager', 'admin']), async (req, res) => {
  try{
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    const monthlyStats = await Order.aggregate([
      {
        $match: {
          status: 'delivered',
          createdAt: { $gte: startOfMonth, $lt: endOfMonth }
        }
      },
      {
        $group: {
          _id: {
            date: {
              $dateToString: {
                format: "%Y-%m-%d",
                date: "$createdAt",
                timezone: "Africa/Nairobi" // ✅ FIXES SHIFT
              }
            },
          },
          dailyRevenue: { $sum: "$total" },
          orderCount: { $sum: 1 }
        }
      },
      { $sort: { "_id.date": 1 } }
    ]);
console.log("Monthly stats:", monthlyStats);
 res.json({ stats: monthlyStats });
}catch(err){
  console.error("Error fetching monthly stats:", err);
  res.status(500).json({ message: 'Failed to fetch monthly stats' });
}
});

app.put('/api/v1/orders/:id/status', auth(['manager', 'admin']), async (req, res) => {
  const { status } = req.body;
  const order = await Order.findByIdAndUpdate(req.params.id, {
    status,
    $push: { trackingUpdates: { status, time: new Date(), note: `Order ${status}` } },
    ...(status === 'delivered' ? { deliveredAt: new Date() } : {}),
  }, { new: true });

  // On delivery: distribute earnings
  if (status === 'delivered') {
    await User.findByIdAndUpdate(order.managerId, { $inc: { walletBalance: order.managerEarning, totalEarnings: order.managerEarning } });
    const admin = await User.findOne({ role: 'admin' });
    if (admin) await User.findByIdAndUpdate(admin._id, { $inc: { adminCommission: order.adminCommission } });

    await Transaction.create({ userId: order.managerId, type: 'earning', amount: order.managerEarning, description: `Earning from order ${order.reference}`, status: 'completed', orderId: order._id });
    await Transaction.create({ userId: admin._id, type: 'commission', amount: order.adminCommission, description: `Commission from order ${order.reference}`, status: 'completed', orderId: order._id });
  }

  io.to(order.clientId.toString()).emit('order_update', { orderId: order._id, status, reference: order.reference });


  const [clientDoc, managerDoc] = await Promise.all([
    User.findById(order.clientId),
    User.findById(order.managerId)]);
  const ref = order.reference;
  const oid = order._id.toString();


  if (status === 'confirmed' && clientDoc?.pushToken)
    push.notifyClientOrderConfirmed(clientDoc.pushToken, ref, oid);
  if (status === 'dispatched' && clientDoc.pushToken)
    push.notifyClientOrderDispatched(clientDoc.pushToken, ref, managerDoc?.name || 'Rider', oid);
  if (status === 'delivered' && clientDoc.pushToken)
    if (clientDoc?.pushToken)
      push.notifyClientOrderDelivered(clientDoc.pushToken, ref, oid);
  if (managerDoc?.pushToken)
    push.notifyManagerEarningsCredited(managerDoc.pushToken, order.managerEarning, ref);
  const admin2 = await User.findOne({ role: 'admin' }).select('pushToken');
  if (admin2?.pushToken)
    push.notifyAdminCommission(admin2.pushToken, order.adminCommission, ref);

  const newNotification = new Notification({
    title: 'Order Update',
    type: 'order_update',
    body: 'Items ' + order.items.map(i => i.name).join(', ') + ' Total + Delivery : 100' + order.status + '',
    recipients: [
      { user: order.clientId, isRead: false },
    ],
    recipientRole: ['client', 'manager', 'admin'],
  });
  await newNotification.save();

  res.json(order);
});

app.get('/api/v1/orders/:id/track', auth(), async (req, res) => {
  const order = await Order.findById(req.params.id).populate('managerId', 'name phone');
  if (!order) return res.status(404).json({ message: 'Order not found' });
  res.json({ status: order.status, updates: order.trackingUpdates, manager: order.managerId, estimatedDelivery: order.estimatedDelivery, deliveredAt: order.deliveredAt });
});

app.post('/api/v1/orders/:id/cancel', auth(), async (req, res) => {
  const order = await Order.findByIdAndUpdate(req.params.id, { status: 'cancelled', cancelReason: req.body.reason, $push: { trackingUpdates: { status: 'cancelled', time: new Date(), note: req.body.reason } } }, { new: true });
  res.json(order);
});

// ─── WALLET    ───────────────────────────────────────────────────────────

app.get('/api/v1/wallet/balance', auth(), async (req, res) => {
  const user = await User.findById(req.user._id);
  const pendingOrders = await Order.find({ clientId: req.user._id, paymentStatus: 'pending' });
  const pendingAmount = pendingOrders.reduce((s, o) => s + o.total, 0);
  res.json({ available: user.walletBalance, pending: pendingAmount, total: user.walletBalance + pendingAmount });
});

app.get('/api/v1/wallet/transactions', auth(), async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const txns = await Transaction.find({ userId: req.user._id }).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit);
  res.json({ transactions: txns, page });
});

app.post('/api/v1/wallet/deposit', auth(), async (req, res) => {
  const { amount, method, phone } = req.body;
  if (method === 'mpesa') {
    // Initiate STK push via Daraja API
    // const stkRes = await initiateMpesaSTK(phone, amount);
    // Save pending transaction
    try {
      const stkRes = await initiateStkPush(phone, amount, null);
      console.log('STK Response:', stkRes);
      const txn = await Transaction.create({ userId: req.user._id, type: 'deposit', amount, method: 'mpesa', status: 'pending', description: `M-Pesa deposit KSh ${amount}`, reference: stkRes.CheckoutRequestID });
      return res.json({ pending: true, transactionId: txn._id, checkoutRequestId: stkRes.CheckoutRequestID, message: 'STK Push sent to your phone' });
    } catch (e) {
      res.status(500).json({ message: 'Error Processing transaction. Try again later.' });
    }

  }
  // Direct deposit (bank/card after verification)
  await User.findByIdAndUpdate(req.user._id, { $inc: { walletBalance: amount } });
  await Transaction.create({ userId: req.user._id, type: 'deposit', amount, method, status: 'completed', description: `Deposit KSh ${amount}` });
  const uForPush = await User.findById(req.user._id).select('pushToken');
  if (uForPush?.pushToken) push.notifyDepositConfirmed(uForPush.pushToken, amount);
  res.json({ success: true, newBalance: (await User.findById(req.user._id)).walletBalance });
});


app.post('/api/v1/wallet/mpesa/callback', async (req, res) => {
  console.log('MPESA CALLBACK:', JSON.stringify(req.body, null, 2));
  const callbackData = req.body.Body?.stkCallback;
  if (!callbackData) return res.json({ success: true });

  const ref = callbackData.CheckoutRequestID;
  let txn = await Transaction.findOne({ reference: ref });
  // Retry if not found
  let retries = 3;
  while (!txn && retries > 0) {
    await new Promise(r => setTimeout(r, 1000));
    txn = await Transaction.findOne({ reference: ref });
    retries--;
  }
  console.log('Txn type:', txn?.type);
  console.log('Txn orderId:', txn?.orderId);
  if (!txn) return res.json({ success: true });

  if (callbackData.ResultCode === 0) {
    console.log('Payment successful for transaction:', txn._id);

    if (txn.type === 'deposit') {
      await User.findByIdAndUpdate(txn.userId, {
        $inc: { walletBalance: txn.amount }
      });
      io.to(txn.userId.toString()).emit('deposit_confirmed', { amount: txn.amount });
      const uForPush = await User.findById(txn.userId).select('pushToken');
      if (uForPush?.pushToken) push.notifyDepositConfirmed(uForPush.pushToken, txn.amount);
      Notification.create({
        title: 'Deposit Received',
        type: 'deposit_confirmed',
        body: `Your deposit of KSh ${txn.amount} has been confirmed (${txn.status}).`,
        recipients: [{ user: txn.userId, isRead: false }],
        recipientRole: ['client', 'manager', 'admin'],
      });

    }

    if (txn.type === 'order_payment' && txn.orderId) {
      await Order.findByIdAndUpdate(txn.orderId, {
        paymentStatus: 'paid'
      });
      io.to(txn.userId.toString()).emit('payment_confirmed', { amount: txn.amount });
      const uForPush = await User.findById(txn.userId).select('pushToken');
      if (uForPush?.pushToken) push.notifyClientPaymentSuccess(uForPush.pushToken, txn.orderId.toString(), txn.amount);
      Notification.create({
        title: 'Payment Received',
        type: 'order_payment',
        body: `Your payment of KSh ${txn.amount} has been confirmed (${txn.status}).`,
        recipients: [{ user: txn.userId, isRead: false }],
        recipientRole: ['client', 'manager', 'admin'],
      });
    }

    txn.status = 'completed';
    await txn.save();

  } else {
    txn.status = 'failed';
    await txn.save();
  }
  Notification.create({
    title: txn.type === 'order_payment' ? 'Payment Received' : 'Deposit Confirmed',
    type: txn.type === 'order_payment' ? 'order_payment' : 'deposit_confirmed',
    body: `Your ${txn.type === 'order_payment' ? 'payment' : 'deposit'} of KSh ${txn.amount} has been confirmed status - ${txn.status}.`,
    recipients: [{ user: txn.userId, isRead: false }],
    recipientRole: ['client', 'manager', 'admin'],
  });
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
});

app.get('/api/v1/wallet/check-status/:reference', auth(), async (req, res) => {
  try {
    const txn = await Transaction.findOne({ reference: req.params.reference, userId: req.user._id });
    if (!txn) return res.status(404).json({ message: 'Transaction not found' });
    res.json({ status: txn.status });
  }
  catch (e) {
    res.status(500).json({ message: 'Error checking transaction status' });
  }
});

app.post('/api/v1/wallet/withdraw', auth(), async (req, res) => {
  const { amount, method, account } = req.body;
  const user = await User.findById(req.user._id);

  // Role-based withdraw limits
  if (user.role === 'admin' && amount > user.adminCommission)
    return res.status(400).json({ message: 'Insufficient commission balance' });
  if (user.role === 'manager' && amount > user.walletBalance)
    return res.status(400).json({ message: 'Insufficient balance' });
  if (user.role === 'client' && amount > user.walletBalance)
    return res.status(400).json({ message: 'Insufficient balance' });

  const balanceField = user.role === 'admin' ? 'adminCommission' : 'walletBalance';
  await User.findByIdAndUpdate(req.user._id, { $inc: { [balanceField]: -amount } });
  await Transaction.create({ userId: req.user._id, type: 'withdrawal', amount: -amount, method, status: 'pending', description: `Withdrawal KSh ${amount} to ${account}` });
  res.json({ success: true, message: 'Withdrawal initiated' });
});

app.post('/api/v1/wallet/pay-order', auth(), async (req, res) => {
  const { orderId, method, phone } = req.body;
  const order = await Order.findById(orderId);
  if (!order) return res.status(404).json({ message: 'Order not found' });
  if (method === 'wallet') {
    const user = await User.findById(req.user._id);
    if (user.walletBalance < order.total) 
      {
        await Transaction.findByIdAndDelete(orderId);
        return res.status(400).json({ message: 'Insufficient wallet balance' });
      }
    await User.findByIdAndUpdate(req.user._id, { $inc: { walletBalance: -order.total } });
    await Order.findByIdAndUpdate(orderId, { paymentStatus: 'paid' });
    await Transaction.create({ userId: req.user._id, type: 'order_payment', amount: -order.total, method: 'wallet', status: 'completed', orderId, description: `Payment for order ${order.reference}` });
    const userForPush = await User.findById(req.user._id).select('pushToken');
    if (userForPush?.pushToken) push.notifyClientPaymentSuccess(userForPush.pushToken, order.reference, order.total);
    return res.json({ success: true, message: 'Order Payment Successful - Wallet' });
  }
  else if (method === 'mpesa') {
    //order.total
    try {
      const stkRes = await initiateStkPush(phone, order.total, orderId);
      console.log('STK Response:', stkRes);
      console.log('Initiated M-Pesa payment for order:', order._id, 'Amount:', order.total);
      const txn = await Transaction.create({
        userId: req.user._id,
        type: 'order_payment',
        amount: order.total,
        method: 'mpesa',
        status: 'pending',
        reference: stkRes.CheckoutRequestID,
        orderId: order._id,
        description: `M-Pesa order payment of KSh ${order.total} for order ${order.reference}`,
      });
      res.json({
        pending: true,
        transactionId: txn._id,
        checkoutRequestId: stkRes.CheckoutRequestID,
        orderId: txn.orderId,
      });

    } catch (e) {
      console.log(e);
      res.status(500).json({ message: 'Payment failed' });
    }
  } else {
    return res.status(400).json({ message: 'Comming soon' });
  }
});

// ─── MANAGERS (Admin only) ────────────────────────────────────────────

app.get('/api/v1/managers', auth(['admin']), async (req, res) => {
  const managers = await User.find({ role: 'manager' }).populate('zoneId', 'name');
  res.json(managers.map(m => ({ id: m._id, name: m.name, email: m.email, phone: m.phone, zone: m.zoneId, balance: m.walletBalance, totalEarnings: m.totalEarnings, isActive: m.isActive, createdAt: m.createdAt })));
});

app.get('/api/v1/managers/:id', auth(['admin']), async (req, res) => {
  const m = await User.findById(req.params.id).populate('zoneId', 'name');
  if (!m) return res.status(404).json({ message: 'Manager not found' });
  res.json({ id: m._id, name: m.name, email: m.email, phone: m.phone, zone: m.zoneId, balance: m.walletBalance, totalEarnings: m.totalEarnings, isActive: m.isActive });
});

app.post('/api/v1/managers', auth(['admin']), async (req, res) => {
  const { name, email, password, phone, zoneId, userName } = req.body;
  if (await User.findOne({ email })) return res.status(400).json({ message: 'Email exists' });
  const hashed = await bcrypt.hash(password, 12);
  const manager = await User.create({ name, email, password: hashed, phone, role: 'manager', zoneId, createdBy: req.user._id, userName: userName || email.split('@')[0] });
  res.status(201).json({ id: manager._id, name: manager.name, email: manager.email });
});

app.post('/api/v1/managers/:id/suspend', auth(['admin']), async (req, res) => {
  await User.findByIdAndUpdate(req.params.id, { isActive: false });
  res.json({ success: true });
});
app.post('/api/v1/managers/:id/activate', auth(['admin']), async (req, res) => {
  await User.findByIdAndUpdate(req.params.id, { isActive: true });
  res.json({ success: true });
});
app.get('/api/v1/managers/:id/sales', auth(['admin']), async (req, res) => {
  const { from, to } = req.query;
  const orders = await Order.find({ managerId: req.params.id, status: 'delivered', createdAt: { $gte: new Date(from), $lte: new Date(to) } });
  const totalRevenue = orders.reduce((s, o) => s + o.total, 0);
  const totalEarnings = orders.reduce((s, o) => s + o.managerEarning, 0);
  res.json({ orders, totalRevenue, totalEarnings, orderCount: orders.length });
});

// ═══════════════════════════════════════════════════════════════════
//  CLIENTS
// ═══════════════════════════════════════════════════════════════════

app.get('/api/v1/clients/new', auth(['manager', 'admin']), async (req, res) => {
  const filter = { role: 'client' };
  if (req.user.zoneId) {
    filter.zoneId = req.user.zoneId;
  }
  if(req.user._id){
    filter.isVerified = 'false';
  }
  const clients = await User.find(filter).select('-password');
  const result = await Promise.all(clients.map(async c => {
    return { id: c._id, name: c.name, email: c.email, phone: c.phone, zoneId: c.zoneId, walletBalance: c.walletBalance, orderCount: 0 , isVerified: c.isVerified, isAdminVerified: c.isAdminVerified, isManagerVerified: c.isManagerVerified };
  }));
  res.json(result);
});

app.put('/api/v1/clients/verify', auth(['manager', 'admin']), async (req, res) => {
  try {
    const { id, isVerified } = req.body;
    console.log("setting manager verification to " + isVerified + " for client " + id);
    const rest = await User.findByIdAndUpdate({ _id: id }, { $set: { isManagerVerified: isVerified } }, { returnDocument: 'after' });
    console.log("updated client " + rest.name + " manager verification to " + rest.isManagerVerified);
    res.json({ success: true, isVerified: rest.isManagerVerified });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.get('/api/v1/clients', auth(['manager', 'admin']), async (req, res) => {
  const filter = { role: 'client' };
  if(req.user._id){
    filter.isVerified = 'true';
  }
  if (req.query.managerId) {
    const orders = await Order.distinct('clientId', { managerId: req.query.managerId });
    filter._id = { $in: orders };
  }
  const clients = await User.find(filter).select('-password');
  const result = await Promise.all(clients.map(async c => {
    const orderCount = await Order.countDocuments({ clientId: c._id });
    return { id: c._id, name: c.name, email: c.email, phone: c.phone, zoneId: c.zoneId, walletBalance: c.walletBalance, orderCount, isVerified: c.isVerified, isAdminVerified: c.isAdminVerified, isManagerVerified: c.isManagerVerified };
  }));
  res.json(result);
});

app.post('/api/v1/clients', auth(['manager']), async (req, res) => {
  try {
    const { name, email, address, phone, zoneId } = req.body;
    if (await User.findOne({ email })) return res.status(400).json({ message: 'Email already exists' });
    const hashed = await bcrypt.hash(address, 12);
    const user = await User.create({ name, email: email.toLowerCase(), password: hashed, phone, role: 'client', zoneId, createdBy: req.user._id });
    res.status(201).json({ id: user._id, name: user.name, email: user.email, role: user.role });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.post('/api/v1/clients/save-token', auth(), async (req, res) => {
  try {
    const { userId, expoToken } = req.body;
    console.log('expo token received from client ' + userId + " token " + expoToken);
    const user = await User.findByIdAndUpdate(userId, { expoToken: expoToken }, { new: true }).lean();
    console.log("saved expo token " + user.expoToken + " for user " + user.name);
    res.json({ success: true, token: user.expoToken });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.get('/api/v1/clients/all', auth(['admin']), async (req, res) => {
  const filter = { role: 'client' };
  const clients = await User.find(filter).select('-password');
  const result = await Promise.all(clients.map(async c => {
    const orderCount = await Order.countDocuments({ clientId: c._id });
    return { id: c._id, name: c.name, email: c.email, phone: c.phone, role: c.role, currentLocation: c.currentLocation, zoneId: c.zoneId, walletBalance: c.walletBalance, orderCount, isVerified: c.isVerified, isAdminVerified: c.isAdminVerified, isManagerVerified: c.isManagerVerified };
  }));
  res.json(result);
});

app.get('/api/v1/clients/:id', auth(['manager', 'admin']), async (req, res) => {
  const m = await User.findById(req.params.id).populate('zoneId', 'name');
  if (!m) return res.status(404).json({ message: 'Client not found' });
  res.json({ id: m._id, name: m.name, email: m.email, phone: m.phone, zone: m.zoneId, balance: m.walletBalance, isVerified: m.isVerified, isAdminVerified: m.isAdminVerified, isManagerVerified: m.isManagerVerified });
});

app.delete('/api/v1/clients/:id', auth(['manager', 'admin']), async (req, res) => {
  await User.findByIdAndDelete(req.params.id);
  res.json({ success: true });
});

//---------------NOTIFICATIONS -----------------------------------------

app.get('/api/v1/notifications', auth(), async (req, res) => {
  // Return all notifications for now
  const notifications = await Notification.find({ "recipients.user": req.user.id }).sort({ createdAt: -1 });
  res.json(notifications);
});

app.get('/api/v1/notifications/all', auth(['admin']), async (req, res) => {
  // Return all notifications for now
  const notifications = await Notification.find({ "recipientRole": 'admin' }).sort({ createdAt: -1 });
  res.json(notifications);
});

app.put('/api/v1/notifications/:id/read', auth(), async (req, res) => {
  // Return all notifications for now
  console.log("marking notification " + req.params.id + " as read for user " + req.user.id);  
 const notification = await Notification.updateOne(
      { _id: req.params.id, "recipients.user": req.user.id },
      { $set: { "recipients.$[elem].isRead": true,"recipients.$[elem].readAt": new Date()}},
      { arrayFilters: [{ "elem.user": req.user.id }]}
    );
    if (!notification) {
      return res.status(404).json({ message: "Notification not found" });
    }
  res.json(notification);
});

app.put('/api/v1/notifications/read-all', auth(), async (req, res) => {
  // Return all notifications for now
  try {    
    const notifications = await Notification.updateMany(
      // 1. Tafuta notification ambazo mtumiaji yumo na bado hajasoma
      { 
        "recipients": { 
          $elemMatch: { user: req.user.id, isRead: false } 
        } 
      },
      // 2. Sasisha isRead na readAt kwa huyo mtumiaji pekee
      { 
        $set: { 
          "recipients.$[elem].isRead": true,
          "recipients.$[elem].readAt": new Date()
        } 
      },
      // 3. Filter ili 'elem' ilingane na userId
      { 
        arrayFilters: [{ "elem.user": req.user.id }],
        multi: true 
      }
    );  
   res.json(notifications);
  } catch (e) { 
    console.log("error marking notifications as read for user " + req.user.id + " error " + e.message);
    return res.status(500).json({ message: 'Error marking notifications as read' });
  } 

 
});

app.post('/api/v1/notifications/push-token', auth(), async (req, res) => {
  try {
    const { token } = req.body;
    console.log('push token received from client ' + req.user.id + " token " + token);
    const user = await User.findByIdAndUpdate(req.user.id, { pushToken: token }, { new: true }).lean();
    console.log("saved push token " + user.pushToken + " for user " + user.name);
    res.json({ success: true, token: user.pushToken });
  } catch (e) { res.status(500).json({ message: e.message }); }
});
// ─── ANALYTICS (Admin) ────────────────────────────────────────────────


app.get('/api/v1/analytics/dashboard', auth(['admin']), async (req, res) => {
  const now = new Date();
  const periods = { day: 86400000, week: 7 * 86400000, month: 30 * 86400000 };
  const from = new Date(now - (periods[req.query.period] || periods.week));

  const [orders, managers, clients, zones, admin] = await Promise.all([
    Order.find({ createdAt: { $gte: from } }),
    User.countDocuments({ role: 'manager', isActive: true }),
    User.countDocuments({ role: 'client' }),
    Zone.countDocuments({ isActive: true }),
    User.findOne({ role: 'admin' }),
  ]);

  const delivered = orders.filter(o => o.status === 'delivered');
  const totalRevenue = delivered.reduce((s, o) => s + o.total, 0);
  const recentActivity = orders.slice(0, 10).map(o => ({
    description: `Order #${o.reference} — ${o.status}`,
    time: getTimeAgo(o.createdAt),
    color: o.status === 'delivered' ? '#22C55E' : o.status === 'cancelled' ? '#EF4444' : '#3B82F6',
  }));


  res.json({
    stats: { totalRevenue: totalRevenue.toLocaleString(), totalOrders: orders.length, activeManagers: managers, activeClients: clients, commissionEarned: (admin?.adminCommission || 0).toLocaleString(), activeZones: zones },
    recentActivity,
  });
});


app.use('/api/v1', auth(), extrasRouter);
app.use('/api/v1/payments', paymentsRouter);
// ─── SOCKET.IO ────────────────────────────────────────────────────────

function getTimeAgo(date) {
  const diff = Date.now() - new Date(date).getTime();
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} min ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} hr ago`;
  return `${Math.floor(diff / 86400000)} days ago`;
}

const attachSocketHandlers = require('./socket-handlers');
attachSocketHandlers(io);

// ─── START ────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`\n🚀 ZoneMarket API running on port ${PORT}`);
  console.log(`📱 Connect your app to: http://YOUR_IP:${PORT}/api/v1\n`);
});

// ── Admin subscribe to live locations ────────────────────────────
app.post('/api/v1/admin/subscribe-live', (req, res) => {
  res.json({ room: 'admin-room', message: 'Connect via socket and emit join_admin' });
});
 
// ── Location history endpoint ─────────────────────────────────────
app.get('/api/v1/users/:id/location-history', async (req, res) => {
  // In production store location history in a separate collection
  // For now return current location
  const user = await User.findById(req.params.id).select('currentLocation name role');
  res.json({ user, history: [] });
});

