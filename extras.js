// backend/extras.js
// All missing endpoints:
//   • Reviews (create, list by order/manager/product, analytics)
//   • Promotions (CRUD, fetch active for zone)
//   • Support Tickets (client submit, manager/admin view, reply)

const express  = require('express');
const router   = express.Router();
const mongoose = require('mongoose');

// ─── Schemas ─────────────────────────────────────────────────────────────────

const ReviewSchema = new mongoose.Schema({
  userId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  userName:    String,
  targetType:  { type: String, enum: ['order','manager','product'], required: true },
  orderId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
  managerId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  productId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  zoneId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Zone' },
  rating:      { type: Number, min: 1, max: 5, required: true },
  comment:     String,
  tags:        [String],
}, { timestamps: true });

const PromoSchema = new mongoose.Schema({
  type:      { type: String, enum: ['banner','popup','card','ticker'], required: true },
  title:     { type: String, required: true },
  subtitle:  String,
  body:      String,
  imageUrl: String,
  emoji:     { type: String, default: '🎁' },
  bgColor:   String,
  textColor: String,
  imageUrl:  String,
  ctaLabel:  String,
  ctaRoute:  String,
  ctaParams: String,
  discount:  Number,
  autoClose: { type: Number, default: 0 },
  priority:  { type: Number, default: 0 },
  isActive:  { type: Boolean, default: true },
  zoneIds:   [{ type: mongoose.Schema.Types.ObjectId, ref: 'Zone' }],
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  startAt:   Date,
  endAt:     Date,
}, { timestamps: true });

const TicketSchema = new mongoose.Schema({
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  userName:  String,
  userPhone: String,
  managerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  zoneId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Zone' },
  category:  { type: String, enum: ['order','payment','delivery','product','account','other'], required: true },
  subject:   { type: String, required: true },
  message:   { type: String, required: true },
  orderId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
  status:    { type: String, enum: ['open','in_progress','resolved','closed'], default: 'open' },
  response:  String,
  respondedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  respondedAt: Date,
}, { timestamps: true });

const Review = mongoose.models.Review || mongoose.model('Review', ReviewSchema);
const Promo  = mongoose.models.Promo  || mongoose.model('Promo',  PromoSchema);
const Ticket = mongoose.models.Ticket || mongoose.model('Ticket', TicketSchema);

// ════════════════════════════════════════════════════════════════════
//  REVIEWS
// ════════════════════════════════════════════════════════════════════

async function recalcProductRating(productId) {
  try {
    const Product = mongoose.model('Product');
    const all = await Review.find({ productId, targetType: 'product' });
    if (!all.length) return;
    const avg = all.reduce((s, r) => s + r.rating, 0) / all.length;
    await Product.findByIdAndUpdate(productId, { averageRating: Math.round(avg * 10) / 10, reviewCount: all.length });
  } catch {}
}
 
// Create a review
router.post('/reviews', async (req, res) => {
  try {
    const User = mongoose.model('User');
    const user = await User.findById(req.user._id).select('name zoneId');
    const { rating, comment, tags, targetType, orderId, managerId, productId } = req.body;

    // Prevent duplicate reviews for same order
    if (targetType === 'order') {
      if (!orderId) return res.status(400).json({ message: 'Order ID is required for order reviews.' });
      const exists = await Review.findOne({ userId: req.user._id, orderId, targetType });
      if (exists) return res.status(400).json({ message: 'You have already reviewed this order.' });
    }
    if(targetType === 'manager'){
      if(!managerId) return res.status(400).json({ message: 'Manager ID is required for manager reviews.' });
      const exists = await Review.findOne({ userId: req.user._id, managerId, targetType });
      if (exists) return res.status(400).json({ message: 'You have already reviewed this manager.' });
    }
     if(targetType === 'product'){
      if(!productId) return res.status(400).json({ message: 'Product ID is required for product reviews.' });
      const exists = await Review.findOne({ userId: req.user._id, productId, targetType });
      if (exists) return res.status(400).json({ message: 'You have already reviewed this product.' });
    }
    const review = await Review.create({
      userId: req.user._id, userName: user.name,
      targetType, rating, comment, tags,
      orderId:   orderId   || undefined,
      managerId: managerId || undefined,
      productId: productId || undefined,
      zoneId:    user.zoneId,
    });

    // Update product average rating if product review
    if (targetType === 'product' && productId) {
      const Product = mongoose.model('Product');
      const allReviews = await Review.find({ productId, targetType: 'product' });
      const avg = allReviews.reduce((s, r) => s + r.rating, 0) / allReviews.length;
      await Product.findByIdAndUpdate(productId, { averageRating: Math.round(avg * 10) / 10, reviewCount: allReviews.length });
    }

    res.status(201).json({ success: true, review });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

router.put('/reviews/:id', async (req, res) => {
  try {
    const review = await Review.findOne({ _id: req.params.id, userId: req.user._id });
    if (!review) return res.status(404).json({ message: 'Not found or not yours' });
    if (req.body.comment !== undefined) review.comment = req.body.comment.trim();
    if (req.body.tags    !== undefined) review.tags    = req.body.tags;
    if (req.body.rating  !== undefined) review.rating  = req.body.rating;
    review.editedAt = new Date();
    await review.save();
    if (review.productId) await recalcProductRating(review.productId.toString());
    res.json({ success: true, review });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// Get reviews for an order
router.get('/reviews/order/:orderId', async (req, res) => {
  try {
    const reviews = await Review.find({ targetType: 'order', orderId: req.params.orderId }).sort({ createdAt: -1 });
   console.log(`Fetched ${reviews.length} reviews for order ${req.params.orderId}`);
    res.json({ reviews, count: reviews.length });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// Get reviews for a manager
router.get('/reviews/manager/:managerId', async (req, res) => {
  try {
   const User = mongoose.model('User');
   console.log('Manager ID for reviews:', req.params.managerId);
   if (!req.params.managerId) return res.status(404).json({ message: 'Manager not found' }); 
    const reviews = await Review.find({ managerId: req.params.managerId, targetType: 'manager' }).sort({ createdAt: -1 }).limit(50);
    const avg = reviews.length ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : 0;
    console.log(`Fetched ${reviews.length} reviews for manager ${req.params.managerId} with average rating ${avg}`);
    res.json({ reviews, count: reviews.length, averageRating: Math.round(avg * 10) / 10 });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// Get reviews for an order
router.get('/reviews/order/recent', async (req, res) => {
  console.log('Fetching recent reviews for zone:', req.user.zoneId);
  try {
    const reviews = await Review.find({ zoneId: req.user.zoneId, targetType: 'order' }).sort({ createdAt: -1 });
    res.json({ reviews, count: reviews.length });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// Get reviews for a product
router.get('/reviews/product/:productId', async (req, res) => {
  try {
    const reviews = await Review.find({ productId: req.params.productId, targetType: 'product' }).sort({ createdAt: -1 }).limit(50);
    const avg = reviews.length ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : 0;
    const breakdown = [5,4,3,2,1].map(n => ({ star: n, count: reviews.filter(r => r.rating === n).length }));
    res.json({ reviews, count: reviews.length, averageRating: Math.round(avg * 10) / 10, breakdown });
  } catch (e) { res.status(500).json({ message: e.message }); }
});


// Manager: get all reviews in their zone
router.get('/reviews/zone', async (req, res) => {
  try {
    const User = mongoose.model('User');
    const user = await User.findById(req.user._id);
    const reviews = await Review.find({ zoneId: user.zoneId }).sort({ createdAt: -1 }).limit(100);
    const avg = reviews.length ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : 0;
    res.json({ reviews, count: reviews.length, averageRating: Math.round(avg * 10) / 10 });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

router.get('/reviews/pending', async (req, res) => {
  try {
    const Order    = mongoose.model('Order');
    const delivered= await Order.find({ clientId:req.user._id, status:'delivered' })
      .sort({ updatedAt:-1 }).limit(20).select('reference total items managerId createdAt updatedAt');
    const reviewed = await Review.find({ userId:req.user._id }).select('orderId');
    const doneIds  = new Set(reviewed.map(r=>r.orderId?.toString()));
    const pending  = delivered.filter(o=>!doneIds.has(o._id.toString()));
    res.json({ pending, reviewedCount:reviewed.length });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// Get reviews by current user (recent orders they can review)
router.get('/reviews/my', async (req, res) => {
  try {
    const Order = mongoose.model('Order');
    const deliveredOrders = await Order.find({ clientId: req.user._id, status: 'delivered' }).sort({ createdAt: -1 }).limit(20);
    const reviewed = await Review.find({ userId: req.user._id }).select('orderId');
    const reviewedIds = reviewed.map(r => r.orderId?.toString());
    const pendingReview = deliveredOrders.filter(o => !reviewedIds.includes(o._id.toString()));
    res.json({ pendingReview, reviewed: reviewed.length });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

router.put('/reviews/:id', async (req, res) => {
  try {
    const review = await Review.findOne({ _id: req.params.id, userId: req.user._id });
    if (!review) return res.status(404).json({ message: 'Not found or not yours' });
    if (req.body.comment !== undefined) review.comment = req.body.comment.trim();
    if (req.body.tags    !== undefined) review.tags    = req.body.tags;
    if (req.body.rating  !== undefined) review.rating  = req.body.rating;
    review.editedAt = new Date();
    await review.save();
    if (review.productId) await recalcProductRating(review.productId.toString());
    res.json({ success: true, review });
  } catch (e) { res.status(500).json({ message: e.message }); }
});
 
router.delete('/reviews/:id', async (req, res) => {
  try {
    const review = await Review.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
    if (!review) return res.status(404).json({ message: 'Not found' });
    if (review.productId) await recalcProductRating(review.productId.toString());
    res.json({ success: true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});
// ════════════════════════════════════════════════════════════════════
//  PROMOTIONS / ADS / BANNERS
// ════════════════════════════════════════════════════════════════════

// Get active promos for client (filtered by zone)
router.get('/promos/active', async (req, res) => {
  try {
    const now  = new Date();
    const User = mongoose.model('User');
    const user = await User.findById(req.user._id).select('zoneId');

    const promos = await Promo.find({
      isActive: true,
      $or: [
        { zoneIds: { $exists: true, $size: 0 } },  // empty = all zones
        { zoneIds: user?.zoneId },                  // specific zone
        { zoneIds: { $exists: false } },
      ],
      $and: [
        { $or: [{ startAt: { $exists: false } }, { startAt: { $lte: now } }] },
        { $or: [{ endAt:   { $exists: false } }, { endAt:   { $gte: now } }] },
      ],
    }).sort({ priority: -1, createdAt: -1 }).limit(20);

    res.json(promos);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// Get all promos (admin/manager panel)
router.get('/promos', async (req, res) => {
  try {
    const filter = {};
    if (req.user.role === 'manager') filter.createdBy = req.user._id;
    if (req.user.role === 'client') filter.createdBy = req.user.managerId;
    const promos = await Promo.find(filter).sort({ createdAt: -1 });
    res.json(promos);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// Create promo (admin or manager)
router.post('/promos', async (req, res) => {
  try {
    const User  = mongoose.model('User');
    const user  = await User.findById(req.user._id).select('zoneId');
    const promo = await Promo.create({
      ...req.body,
      createdBy: req.user._id,
      zoneIds:   req.user.role === 'manager' ? [user.zoneId] : (req.body.zoneIds || []),
    });
    res.status(201).json(promo);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// Update promo
router.put('/promos/:id', async (req, res) => {
  try {
    const promo = await Promo.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!promo) return res.status(404).json({ message: 'Promo not found' });
    res.json(promo);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// Delete promo
router.delete('/promos/:id', async (req, res) => {
  try {
    await Promo.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ════════════════════════════════════════════════════════════════════
//  SUPPORT TICKETS
// ════════════════════════════════════════════════════════════════════

// Client: submit ticket
router.post('/support/tickets', async (req, res) => {
  try {
    console.log('Creating ticket with data:', req.body);
    const User = mongoose.model('User');
    const user = await User.findById(req.user._id).select('name phone zoneId managerId');
    console.log('User data for ticket:', user);
    const ticket = await Ticket.create({
      userId:    req.user._id,
      userName:  user.name,
      userPhone: user.phone,
      managerId: user.managerId,
      zoneId:    user.zoneId,
      category:  req.body.category,
      subject:   req.body.subject,
      message:   req.body.message,
      orderId:   req.body.orderId || undefined,
    });
    console.log('Ticket created:', ticket);
    res.status(201).json({ success: true, ticket });
    console.log('Ticket creation response sent'); 
  } catch (e) { 
    
    console.error('Error creating ticket:', e);
    res.status(500).json({ message: e.message }); }
});

// Client: get own tickets
router.get('/support/tickets', async (req, res) => {
  try {
    const tickets = await Ticket.find({ userId: req.user._id }).sort({ createdAt: -1 });
    res.json(tickets);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// Manager: get tickets from their clients
router.get('/support/tickets/manager', async (req, res) => {
  try {
    const filter = { managerId: req.user._id };
    if (req.query.status) filter.status = req.query.status;
    const tickets = await Ticket.find(filter)
      .populate('userId', 'name phone')
      .populate('orderId', 'reference total')
      .sort({ createdAt: -1 });
    res.json(tickets);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// Admin: get all tickets
router.get('/support/tickets/admin', async (req, res) => {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    const tickets = await Ticket.find(filter)
      .populate('userId', 'name phone')
      .populate('managerId', 'name')
      .populate('orderId', 'reference total')
      .sort({ createdAt: -1 })
      .limit(200);
    res.json(tickets);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// Manager/Admin: reply to ticket + update status
router.put('/support/tickets/:id/reply', async (req, res) => {
  try {
    const { response, status } = req.body;
    const ticket = await Ticket.findByIdAndUpdate(req.params.id, {
      response, status: status || 'in_progress',
      respondedBy: req.user._id, respondedAt: new Date(),
    }, { new: true });
    if (!ticket) return res.status(404).json({ message: 'Ticket not found' });

    // Push notification to client
    const User = mongoose.model('User');
    const client = await User.findById(ticket.userId).select('pushToken');
    if (client?.pushToken) {
      const push = require('./pushNotifications');
      push.sendPushNotification(
        client.pushToken,
        'Support Reply',
        `Your ticket "${ticket.subject}" has been updated.`,
        { type: 'support', ticketId: ticket._id.toString() },
        'general'
      );
    }
    res.json({ success: true, ticket });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// Manager/Admin: close ticket
router.put('/support/tickets/:id/close', async (req, res) => {
  try {
    const ticket = await Ticket.findByIdAndUpdate(req.params.id, { status: 'closed' }, { new: true });
    res.json({ success: true, ticket });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

module.exports = { router, Review, Promo, Ticket };
