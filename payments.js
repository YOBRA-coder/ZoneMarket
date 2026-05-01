// backend/payments.js
// Complete payment system:
//   • Stripe card payments (checkout + direct charge)
//   • Bank account withdrawals (Pesalink / EFT Kenya)
//   • M-Pesa STK Push (already in server.js, extended here)
//   • Withdrawal queue + admin approval flow

const express = require('express');
const router  = express.Router();
const Stripe  = require('stripe');
const axios   = require('axios');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_YOUR_STRIPE_KEY');

// ── Models (imported via mongoose connection already open) ─────────────────
const mongoose = require('mongoose');

const WithdrawalSchema = new mongoose.Schema({
  userId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  amount:      { type: Number, required: true },
  method:      { type: String, enum: ['mpesa', 'bank', 'stripe'], required: true },
  status:      { type: String, enum: ['pending', 'processing', 'completed', 'failed', 'rejected'], default: 'pending' },
  // M-Pesa fields
  mpesaPhone:  String,
  mpesaRef:    String,
  // Bank fields
  bankName:    String,
  accountName: String,
  accountNo:   String,
  bankCode:    String, // Pesalink/SWIFT code
  // Stripe fields
  stripeTransferId: String,
  // General
  reference:   String,
  note:        String,
  adminNote:   String,
  processedAt: Date,
  processedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

const PaymentIntentSchema = new mongoose.Schema({
  userId:          { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  stripeIntentId:  String,
  amount:          Number, // in KES
  amountCents:     Number, // in USD cents (Stripe)
  currency:        { type: String, default: 'usd' },
  status:          { type: String, default: 'pending' },
  purpose:         { type: String, enum: ['wallet_deposit', 'order_payment'] },
  orderId:         { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
  metadata:        mongoose.Schema.Types.Mixed,
}, { timestamps: true });

const Withdrawal = mongoose.models.Withdrawal || mongoose.model('Withdrawal', WithdrawalSchema);
const PaymentIntent = mongoose.models.PaymentIntent || mongoose.model('PaymentIntent', PaymentIntentSchema);

// ── Middleware (auth passed from server.js) ───────────────────────────────
// router uses req.user set by auth() middleware in server.js

// ═══════════════════════════════════════════════════════════════════════════
//  STRIPE PAYMENTS
// ═══════════════════════════════════════════════════════════════════════════
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
// Conversion rate: KES → USD (update via env or fetch live)
const KES_TO_USD = parseFloat(process.env.KES_TO_USD || '0.0077'); // ~130 KES per 1 USD

function kesToCents(kes) {
  return Math.round(kes * KES_TO_USD * 100); // Stripe uses cents
}

// Create Stripe PaymentIntent (client gets client_secret to complete payment in app)
router.post('/stripe/create-payment-intent', async (req, res) => {
  try {
    const { amount, purpose, orderId } = req.body; // amount in KES
    if (!amount || amount < 10) return res.status(400).json({ message: 'Minimum amount is KSh 10' });

    const amountCents = kesToCents(amount);

    const intent = await stripe.paymentIntents.create({
      amount:   amountCents,
      currency: 'usd',
      automatic_payment_methods: { enabled: true },
      metadata: {
        userId:   req.user._id.toString(),
        purpose:  purpose || 'wallet_deposit',
        amountKes: amount.toString(),
        orderId:  orderId || '',
        appName:  'ZoneMarket',
      },
      description: `ZoneMarket - ${purpose === 'order_payment' ? `Order payment` : 'Wallet deposit'} - KSh ${amount}`,
    });

    // Save intent to DB
    await PaymentIntent.create({
      userId: req.user._id,
      stripeIntentId: intent.id,
      amount, amountCents,
      currency: 'usd',
      status: 'pending',
      purpose: purpose || 'wallet_deposit',
      orderId: orderId || undefined,
    });

    res.json({
      clientSecret:    intent.client_secret,
      paymentIntentId: intent.id,
      amountUsd:       (amountCents / 100).toFixed(2),
      amountKes:       amount,
    });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// Confirm Stripe payment (called after card is charged successfully in app)
router.post('/stripe/confirm-payment', async (req, res) => {
  try {
    const { paymentIntentId } = req.body;
    const User = mongoose.model('User');
    const Transaction = mongoose.model('Transaction');
    const Order = mongoose.model('Order');

    // Verify with Stripe
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (intent.status !== 'succeeded') {
      return res.status(400).json({ message: `Payment not completed. Status: ${intent.status}` });
    }

    // Find local record
    const record = await PaymentIntent.findOne({ stripeIntentId: paymentIntentId });
    if (!record) return res.status(404).json({ message: 'Payment record not found' });
    if (record.status === 'completed') return res.json({ success: true, message: 'Already processed' });

    const amountKes = parseInt(intent.metadata.amountKes);
    const purpose   = intent.metadata.purpose;

    if (purpose === 'wallet_deposit') {
      // Add to wallet
      await User.findByIdAndUpdate(req.user._id, { $inc: { walletBalance: amountKes } });
      await Transaction.create({
        userId: req.user._id,
        type: 'deposit',
        amount: amountKes,
        method: 'stripe',
        status: 'completed',
        reference: paymentIntentId,
        description: `Stripe card deposit KSh ${amountKes}`,
      });
    } else if (purpose === 'order_payment') {
      const orderId = intent.metadata.orderId;
      await Order.findByIdAndUpdate(orderId, { paymentStatus: 'paid' });
      await Transaction.create({
        userId: req.user._id,
        type: 'order_payment',
        amount: -amountKes,
        method: 'stripe',
        status: 'completed',
        reference: paymentIntentId,
        orderId,
        description: `Stripe payment for order`,
      });
    }

    await PaymentIntent.findByIdAndUpdate(record._id, { status: 'completed' });

    res.json({
      success: true,
      message: purpose === 'wallet_deposit'
        ? `KSh ${amountKes} added to wallet via card`
        : 'Order payment confirmed',
      amountKes,
    });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// Stripe Webhook (server receives events from Stripe — set in Stripe dashboard)
router.post('/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret || 'whsec_test');
  } catch (e) {
    return res.status(400).send(`Webhook Error: ${e.message}`);
  }

  if (event.type === 'payment_intent.succeeded') {
    const intent = event.data.object;
    // Auto-process if not already done (backup for when app confirm endpoint fails)
    const record = await PaymentIntent.findOne({ stripeIntentId: intent.id });
    if (record && record.status !== 'completed') {
      const User = mongoose.model('User');
      const Transaction = mongoose.model('Transaction');
      const amountKes = parseInt(intent.metadata.amountKes || '0');
      if (intent.metadata.purpose === 'wallet_deposit' && amountKes > 0) {
        await User.findByIdAndUpdate(record.userId, { $inc: { walletBalance: amountKes } });
        await Transaction.create({ userId: record.userId, type: 'deposit', amount: amountKes, method: 'stripe', status: 'completed', reference: intent.id, description: `Stripe deposit KSh ${amountKes}` });
        await PaymentIntent.findByIdAndUpdate(record._id, { status: 'completed' });
        console.log(`✅ Webhook: Stripe deposit KSh ${amountKes} for user ${record.userId}`);
      }
    }
  }

  res.json({ received: true });
});

// ═══════════════════════════════════════════════════════════════════════════
//  BANK WITHDRAWALS (Kenya Pesalink / EFT)
// ═══════════════════════════════════════════════════════════════════════════

const KENYA_BANKS = [
  { code: '01', name: 'Kenya Commercial Bank (KCB)', swift: 'KCBLKENX' },
  { code: '02', name: 'Equity Bank', swift: 'EQBLKENA' },
  { code: '03', name: 'Co-operative Bank', swift: 'KCOOKENA' },
  { code: '04', name: 'Absa Bank Kenya', swift: 'BARCKENX' },
  { code: '05', name: 'Standard Chartered Bank', swift: 'SCBLKENX' },
  { code: '06', name: 'Diamond Trust Bank', swift: 'DTKEKENA' },
  { code: '07', name: 'NCBA Bank', swift: 'CBAFKENX' },
  { code: '08', name: 'I&M Bank', swift: 'IMBLKENA' },
  { code: '09', name: 'Family Bank', swift: 'FABLKENA' },
  { code: '10', name: 'Prime Bank', swift: 'PRBLKENA' },
  { code: '11', name: 'National Bank of Kenya', swift: 'NBKEKENX' },
  { code: '12', name: 'Stanbic Bank', swift: 'SBICKENX' },
  { code: '13', name: 'Gulf African Bank', swift: '' },
  { code: '14', name: 'Bank of Africa', swift: 'AFRIKENX' },
  { code: '15', name: 'Sidian Bank', swift: '' },
  { code: '16', name: 'Postbank / PostaPesa', swift: '' },
];

router.get('/banks', (req, res) => {
  res.json(KENYA_BANKS);
});

// Submit bank withdrawal request
router.post('/withdraw/bank', async (req, res) => {
  try {
    const { amount, bankCode, bankName, accountName, accountNo, note } = req.body;
    const User = mongoose.model('User');
    const Transaction = mongoose.model('Transaction');

    if (!amount || amount < 100) return res.status(400).json({ message: 'Minimum withdrawal is KSh 100' });
    if (!bankCode || !accountName?.trim() || !accountNo?.trim())
      return res.status(400).json({ message: 'Bank details are required' });

    const user = await User.findById(req.user._id);
    const balField = user.role === 'admin' ? 'adminCommission' : 'walletBalance';
    const available = user[balField] || 0;

    if (amount > available)
      return res.status(400).json({ message: `Insufficient balance. Available: KSh ${available.toLocaleString()}` });

    // Deduct balance immediately (hold funds)
    await User.findByIdAndUpdate(req.user._id, { $inc: { [balField]: -amount } });

    const reference = 'BNK' + Date.now();

    // Create withdrawal record (pending admin processing)
    const withdrawal = await Withdrawal.create({
      userId: req.user._id,
      amount, method: 'bank',
      status: 'pending',
      bankName, bankCode, accountName: accountName.trim(), accountNo: accountNo.trim(),
      reference, note: note?.trim(),
    });

    // Create pending transaction
    await Transaction.create({
      userId: req.user._id,
      type: 'withdrawal',
      amount: -amount,
      method: 'bank',
      status: 'pending',
      reference,
      description: `Bank withdrawal KSh ${amount} to ${bankName} ${accountNo}`,
    });

    res.json({
      success: true,
      withdrawalId: withdrawal._id,
      reference,
      message: `Withdrawal of KSh ${amount.toLocaleString()} to ${bankName} submitted. Processing within 1–3 business days.`,
    });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// M-Pesa withdrawal (immediate via Daraja B2C)
router.post('/withdraw/mpesa', async (req, res) => {
  try {
    const { amount, phone, note } = req.body;
    const User = mongoose.model('User');
    const Transaction = mongoose.model('Transaction');

    if (!amount || amount < 10) return res.status(400).json({ message: 'Minimum withdrawal is KSh 10' });

    const formattedPhone = phone.startsWith('0') ? `254${phone.slice(1)}` : phone;

    const user = await User.findById(req.user._id);
    const balField = user.role === 'admin' ? 'adminCommission' : 'walletBalance';
    if (amount > (user[balField] || 0))
      return res.status(400).json({ message: `Insufficient balance` });

    await User.findByIdAndUpdate(req.user._id, { $inc: { [balField]: -amount } });

    const reference = 'MPW' + Date.now();

    // Try Daraja B2C
    let mpesaRef = null;
    try {
      const token = await getMpesaToken();
      const b2cRes = await axios.post(
        'https://sandbox.safaricom.co.ke/mpesa/b2c/v1/paymentrequest',
        {
          InitiatorName:      process.env.MPESA_INITIATOR_NAME || 'testapi',
          SecurityCredential: process.env.MPESA_SECURITY_CREDENTIAL || '',
          CommandID:          'BusinessPayment',
          Amount:             Math.floor(amount),
          PartyA:             process.env.MPESA_SHORTCODE,
          PartyB:             formattedPhone,
          Remarks:            'ZoneMarket withdrawal',
          QueueTimeOutURL:    `${process.env.MPESA_CALLBACK_URL}/timeout`,
          ResultURL:          `${process.env.MPESA_CALLBACK_URL}/b2c-result`,
          Occasion:           reference,
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      mpesaRef = b2cRes.data?.ConversationID;
    } catch (mpesaErr) {
      // Sandbox may not support B2C — log and continue
      console.warn('M-Pesa B2C failed (sandbox):', mpesaErr.message);
    }

    await Withdrawal.create({
      userId: req.user._id, amount, method: 'mpesa',
      status: mpesaRef ? 'processing' : 'pending',
      mpesaPhone: phone, mpesaRef: mpesaRef || undefined, reference,
    });

    await Transaction.create({
      userId: req.user._id, type: 'withdrawal', amount: -amount,
      method: 'mpesa', status: mpesaRef ? 'processing' : 'pending',
      reference, description: `M-Pesa withdrawal KSh ${amount} to ${phone}`,
      mpesaRef: mpesaRef || undefined,
    });

    res.json({
      success: true, reference, mpesaRef,
      message: `KSh ${amount.toLocaleString()} sent to ${phone}. ${mpesaRef ? 'Processing via M-Pesa.' : 'Will be processed shortly.'}`,
    });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// Get all withdrawals for a user
router.get('/withdrawals', auth(), async (req, res) => {
  try { 
  const withdrawals = await Withdrawal.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(50);
  res.json(withdrawals);
  } catch (e) {
    console.error('Error fetching withdrawals:', e);
    res.status(500).json({ message: e.message });
  }
});

// Admin: get all pending withdrawals
router.get('/withdrawals/admin/pending', async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Admin only' });
  const withdrawals = await Withdrawal.find({ status: 'pending' }).populate('userId', 'name email phone role').sort({ createdAt: 1 });
  res.json(withdrawals);
});

// Admin: approve / reject withdrawal
router.put('/withdrawals/:id/status', async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Admin only' });
  const { status, adminNote } = req.body;
  if (!['completed', 'rejected', 'processing'].includes(status))
    return res.status(400).json({ message: 'Invalid status' });

  const withdrawal = await Withdrawal.findByIdAndUpdate(req.params.id, {
    status, adminNote, processedAt: new Date(), processedBy: req.user._id,
  }, { new: true });

  if (status === 'rejected') {
    // Refund balance
    const User = mongoose.model('User');
    const user = await User.findById(withdrawal.userId);
    const balField = user.role === 'admin' ? 'adminCommission' : 'walletBalance';
    await User.findByIdAndUpdate(withdrawal.userId, { $inc: { [balField]: withdrawal.amount } });
  }

  res.json({ success: true, withdrawal });
});

// ── M-Pesa token helper ────────────────────────────────────────────────────
async function getMpesaToken() {
  const creds = Buffer.from(`${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`).toString('base64');
  const res = await axios.get('https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials', {
    headers: { Authorization: `Basic ${creds}` },
  });
  return res.data.access_token;
}

module.exports = { router, Withdrawal, PaymentIntent, KENYA_BANKS };