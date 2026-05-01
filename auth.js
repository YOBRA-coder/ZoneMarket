// backend/auth.js
// ─── New Referral System Design ────────────────────────────────────────────
//
//  MANAGER:
//   • Has a permanent referral code generated at account creation
//   • Can send that code to clients via SMS directly from the app
//   • Can see all clients who used their code
//   • Code never expires UNLESS manager marks it inactive
//
//  CLIENT:
//   • CANNOT register without a valid referral code from a manager
//   • CANNOT login if they have no active referral (manager removed / deactivated)
//   • If referral becomes inactive, client sees "Contact your manager for a new code"
//   • When client tries to login with inactive referral → they can enter new code
//
//  REFERRAL EXPIRY by inactivity:
//   • A client's access expires if they have NOT placed an order in N days (configurable)
//   • On login attempt: server checks last_order_at vs INACTIVITY_DAYS
//   • If expired: login blocked, message shown, client must get new code from manager
//   • Manager can "re-activate" client by sharing code again (client enters it at login)
//
// ───────────────────────────────────────────────────────────────────────────

const express  = require('express');
const router   = express.Router();
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const mongoose = require('mongoose');
const crypto   = require('crypto');
const axios    = require('axios');

const JWT_SECRET        = process.env.JWT_SECRET || 'zonemarket_secret_2024';
const INACTIVITY_DAYS   = parseInt(process.env.CLIENT_INACTIVITY_DAYS || '30'); // days before access expires

// ─── Schemas ─────────────────────────────────────────────────────────────────

const OtpSchema = new mongoose.Schema({
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  phone:     { type: String, required: true },
  code:      { type: String, required: true },
  purpose:   { type: String, enum: ['verify_register','verify_login','reactivate'], required: true },
  attempts:  { type: Number, default: 0 },
  expiresAt: { type: Date, required: true },
  used:      { type: Boolean, default: false },
}, { timestamps: true });
OtpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const ReferralSchema = new mongoose.Schema({
  code:       { type: String, unique: true, required: true, uppercase: true },
  managerId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  zoneId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Zone' },
  zoneName:   String,
  isActive:   { type: Boolean, default: true },
  // Clients who registered via this code
  clients: [{
    userId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    joinedAt:   { type: Date, default: Date.now },
    lastOrderAt: Date,
    isActive:   { type: Boolean, default: true },  // manager can deactivate individual client
    phone:      String,
    name:       String,
  }],
}, { timestamps: true });

const Otp      = mongoose.models.Otp      || mongoose.model('Otp', OtpSchema);
const Referral2 = mongoose.models.Referral || mongoose.model('Referral', ReferralSchema);

module.exports._Referral = Referral2; // export for server.js to update lastOrderAt

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function generateReferralCode(name) {
  const prefix = (name || 'MGR').slice(0, 3).toUpperCase().replace(/[^A-Z]/g, 'X');
  const suffix = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `${prefix}${suffix}`;
}

function maskPhone(phone) {
  if (!phone) return '—';
  const p = phone.toString();
  return p.length > 7 ? p.slice(0, 4) + '****' + p.slice(-3) : p;
}

async function sendSms(phone, message) {
  const formatted = phone.startsWith('+') ? phone
    : phone.startsWith('0') ? `+254${phone.slice(1)}`
    : `+${phone}`;

  if (process.env.AT_API_KEY && process.env.AT_USERNAME) {
    const isSandbox = process.env.AT_USERNAME === 'sandbox';
const url = isSandbox 
  ? 'https://api.sandbox.africastalking.com/version1/messaging' 
  : 'https://api.africastalking.com/version1/messaging';
   try {
  const params = new URLSearchParams();
  params.append('username', process.env.AT_USERNAME);
  params.append('to', formatted);
  params.append('message', message);
 

  const response = await axios.post(
    url, 
    params, 
    {
      headers: { 
        apiKey: 'atsk_e32e8b4146c7072b2b12115973bcc5345412a5cf4116119014cc0adcb655fbd4611ae04b', 
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json' 
      },
    }
  );

  console.log('AT SMS Success:', response.data);
console.log(message)
  return true;
} catch (e) {
  // Log the actual response error from Africa's Talking
  console.warn('AT SMS failed:', e.response?.data || e.message);
console.log(message)
  return false;
}

  }

  if (process.env.TWILIO_ACCOUNT_SID) {
    try {
      await axios.post(
        `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`,
        new URLSearchParams({ To: formatted, From: process.env.TWILIO_PHONE, Body: message }),
        { auth: { username: process.env.TWILIO_ACCOUNT_SID, password: process.env.TWILIO_AUTH_TOKEN } }
      );
      return true;
    } catch (e) { console.warn('Twilio failed:', e.message); }
  }

  // Dev fallback
  console.log(`\n📱 ═══ SMS to ${formatted} ═══\n   ${message}\n═══════════════════════════\n`);
  return true;
}

function buildUserPayload(user) {
  return {
    id: user._id, name: user.name, email: user.email,
    phone: user.phone, userName: user.userName, role: user.role,
    zoneId: user.zoneId?._id || user.zoneId,
    zoneName: user.zoneId?.name || user.zoneName || '',
    walletBalance: user.walletBalance || 0,
    adminCommission: user.adminCommission || 0,
    isVerified: user.isVerified, avatar: user.avatar,
    managerId: user.managerId, createdAt: user.createdAt,
  };
}

// ─── Check client inactivity ──────────────────────────────────────────────────
async function checkClientAccess(user) {
  if (user.role !== 'client') return { allowed: true };
  
  // Must have a managerId (set at registration via referral)
  if (!user.managerId) return { allowed: false, reason: 'no_referral', message: 'You need a referral code from a manager to access ZoneMarket.' };

  // Check referral is still active for this client
  const referral = await Referral2.findOne({
    managerId: user.managerId,
    'clients.userId': user._id,
  });

  if (!referral) return { allowed: false, reason: 'no_referral', message: 'No active referral found. Ask your manager for a new code.' };

  const clientEntry = referral.clients.find(c => c.userId.toString() === user._id.toString());
  if (!clientEntry?.isActive) return { allowed: false, reason: 'deactivated', message: 'Your access has been deactivated. Contact your manager.' };
  if (!referral.isActive) return { allowed: false, reason: 'deactivated', message: 'Your manager\'s referral code is no longer active.' };

  // Check inactivity
  if (INACTIVITY_DAYS > 0 && clientEntry.lastOrderAt) {
    const daysSinceLast = (Date.now() - new Date(clientEntry.lastOrderAt).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceLast > INACTIVITY_DAYS) {
      return {
        allowed: false,
        reason: 'inactive',
        message: `Your account has been inactive for more than ${INACTIVITY_DAYS} days. Ask your manager to resend your referral code to reactivate.`,
        daysSinceLast: Math.floor(daysSinceLast),
      };
    }
  }

  return { allowed: true, referral, clientEntry };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  VALIDATE REFERRAL CODE  (public — no auth needed)
//  GET /api/v1/auth/referral/:code
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/referral/:code', async (req, res) => {
  try {
    const ref = await Referral2.findOne({ code: req.params.code.toUpperCase(), isActive: true })
      .populate('managerId', 'name phone')
      .populate('zoneId', 'name');

    if (!ref) return res.status(404).json({ valid: false, message: 'Invalid or expired referral code' });

    res.json({
      valid:       true,
      code:        ref.code,
      managerName: ref.managerId?.name || 'Manager',
      zoneName:    ref.zoneId?.name || 'Your Zone',
      zoneId:      ref.zoneId?._id,
      managerId:   ref.managerId?._id,
      clientCount: ref.clients.filter(c => c.isActive).length,
    });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  REGISTER  (client only — requires referral code from manager)
//  POST /api/v1/auth/register
// ═══════════════════════════════════════════════════════════════════════════════
router.post('/register', async (req, res) => {
  try {
    const { name, email, phone, password, referralCode, username } = req.body;

    if (!name?.trim())        return res.status(400).json({ message: 'Full name is required' });
    if (!phone?.trim())       return res.status(400).json({ message: 'Phone number is required' });
    if (!password || password.length < 6) return res.status(400).json({ message: 'Password must be at least 6 characters' });
    if (!referralCode?.trim()) return res.status(400).json({ message: 'Referral code is required. Ask your manager for one.' });

    const User = mongoose.model('User');
    const cleanPhone = phone.replace(/[\s-]/g, '');
    const cleanEmail = email?.toLowerCase().trim();
    const cleanUser  = username?.toLowerCase().trim();

    // Check duplicates
    const existPhone = await User.findOne({ phone: cleanPhone });
    if (existPhone) return res.status(400).json({ message: 'Phone number already registered' });
    if (cleanEmail) {
      const existEmail = await User.findOne({ email: cleanEmail });
      if (existEmail) return res.status(400).json({ message: 'Email already registered' });
    }
    if (cleanUser) {
      const existUser = await User.findOne({ username: cleanUser });
      if (existUser) return res.status(400).json({ message: 'Username already taken' });
    }

    // Validate referral code
    const referral = await Referral2.findOne({ code: referralCode.toUpperCase(), isActive: true })
      .populate('zoneId', 'name');
    if (!referral) return res.status(400).json({ message: 'Invalid or expired referral code. Ask your manager for a valid code.' });

    // Create client user
    const hashed = await bcrypt.hash(password, 12);
    const user = await User.create({
      name: name.trim(),
      email: cleanEmail || undefined,
      phone: cleanPhone,
      userName: cleanUser || undefined,
      password: hashed,
      role: 'client',
      zoneId:    referral.zoneId?._id,
      zoneName:  referral.zoneId?.name || '',
      managerId: referral.managerId,
      isVerified: false,
      isActive:   false,
    });

    // Add client to referral record
    await Referral2.findByIdAndUpdate(referral._id, {
      $push: {
        clients: {
          userId: user._id, phone: cleanPhone, name: name.trim(),
          joinedAt: new Date(), isActive: true,
        },
      },
    });

    // Send OTP
    const code = generateOtp();
    await Otp.deleteMany({ userId: user._id, purpose: 'verify_register' });
    await Otp.create({ userId: user._id, phone: cleanPhone, code, purpose: 'verify_register', expiresAt: new Date(Date.now() + 20 * 60 * 1000) });
    await sendSms(cleanPhone, `ZoneMarket: Your verification code is ${code}. Expires in 20 minutes. DO NOT share it.`);

    res.status(201).json({
      success: true,
      userId: user._id,
      phone: maskPhone(cleanPhone),
      managerName: (await User.findById(referral.managerId).select('name'))?.name || 'Your Manager',
      zoneName: referral.zoneId?.name || '',
      message: `Verification code sent to ${maskPhone(cleanPhone)}. Enter ${code} to activate your account.`,
    });
  } catch (e) {
    console.error('Register error:', e);
    res.status(500).json({ message: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  LOGIN  (step 1 — credentials)
//  POST /api/v1/auth/login
//  identifier = email | phone | username
// ═══════════════════════════════════════════════════════════════════════════════
router.post('/login', async (req, res) => {
  try {
    const { identifier, password, referralCode } = req.body;
    const id = (identifier || '').trim();
    if (!id)       return res.status(400).json({ message: 'Enter your phone, email or username' });
    if (!password) return res.status(400).json({ message: 'Password is required' });
 
    const User = mongoose.model('User');
 
    // Find user by phone, email, or username
    const user = await User.findOne({
      $or: [
        { phone: id },
        { phone: id.startsWith('0') ? `+254${id.slice(1)}` : id },
        { phone: id.startsWith('+254') ? `0${id.slice(4)}` : id },
        { email: id.toLowerCase() },
        { username: id.toLowerCase() },
      ],
    }).populate('zoneId', 'name');
 
    if (!user) return res.status(401).json({ message: 'No account found. Check your phone, email, or username.' });
 
    const pwOk = await bcrypt.compare(password, user.password);
    if (!pwOk) return res.status(401).json({ message: 'Incorrect password.' });
 
    if (!user.isActive && !user.isVerified) {
      // Not yet verified — resend register OTP
      const code = generateOtp();
      await Otp.deleteMany({ userId: user._id, purpose: 'verify_register' });
      await Otp.create({ userId: user._id, phone: user.phone, code, purpose: 'verify_register', expiresAt: new Date(Date.now() + 20 * 60 * 1000) });
      await sendSms(user.phone, `ZoneMarket: Verify your account. Code: ${code}. Valid 20 mins.`);
      return res.json({ requiresVerification: true, userId: user._id, phone: maskPhone(user.phone), message: 'Account not verified. A new code has been sent to your phone.' });
    }
 
    // Account suspended by admin — show referral/reactivation screen
    if (!user.isActive) {
      return res.status(403).json({
        needsReferral: true,
        reason: 'suspended',
        userId: user._id,
        phone: maskPhone(user.phone),
        message: 'Your account has been suspended. Contact your manager for a new referral code to reactivate.',
        hint: 'Enter a valid referral code from your manager to restore access.',
      });
    }
    // For clients: check referral access
    if (user.role === 'client') {
      const access = await checkClientAccess(user);
      if (!access.allowed) {
        // Allow reactivation via referral code
        if (!referralCode) {
            return res.status(403).json({
              needsReferral: true,
              reason: access.reason,
              userId: user._id,
              phone: maskPhone(user.phone),
              message: 'Referral code is required to reactivate your account. Ask your manager for a valid code.',
            }); 
        }
          const newRef = await Referral2.findOne({ code: referralCode.toUpperCase(), isActive: true });
          if (!newRef) {
            return res.status(400).json({
              needsReferral: true,
              reason: access.reason,
              userId: user._id,
              phone: maskPhone(user.phone),
              message: 'Invalid referral code. Ask your manager for a valid one.',
            });
          }
          // Add to referral record + reactivate user
          await Referral2.findByIdAndUpdate(newRef._id, {
            $push: { clients: { userId: user._id, phone: user.phone, name: user.name, joinedAt: new Date(), isActive: true } },
          });
          await User.findByIdAndUpdate(user._id, {
            managerId: newRef.managerId,
            zoneId: newRef.zoneId,
            isActive: true,
          });
          // Fall through to send login OTP
      
      }
    }
 
    // Send login OTP
    const code = generateOtp();
    await Otp.deleteMany({ userId: user._id, purpose: 'verify_login' });
    const otp = await Otp.create({ userId: user._id, phone: user.phone, code, purpose: 'verify_login', expiresAt: new Date(Date.now() + 20 * 60 * 1000) });
    // await sendSms(user.phone, `ZoneMarket login code: ${code}\nValid 20 minutes. Never share this code with anyone.`);
    console.log(`Login OTP for ${user.phone}: ${code}`); // Log OTP for testing without SMS
    res.json({
      success: true,
      requiresOtp: true,
      userId: user._id,
      phone: maskPhone(user.phone),
      expiresAt: otp.expiresAt,
      message: `Code sent to ${maskPhone(user.phone)}. Enter ${code} to sign in.`,
    });
  } catch (e) {
    console.error('Login error:', e);
    res.status(500).json({ message: e.message || "An error occurred" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  VERIFY OTP  (completes register OR login)
//  POST /api/v1/auth/verify-otp
// ═══════════════════════════════════════════════════════════════════════════════
router.post('/verify-otp', async (req, res) => {
  try {
    const { userId, code, purpose } = req.body;
    const User = mongoose.model('User');

    const otp = await Otp.findOne({
      userId, purpose: purpose || 'verify_login',
      used: false, expiresAt: { $gt: new Date() },
    }).sort({ createdAt: -1 });

    if (!otp) return res.status(400).json({ message: 'Code expired or not found. Request a new one.' });
    if (otp.attempts >= 5) return res.status(400).json({ message: 'Too many wrong attempts. Request a new code.' });

    if (otp.code !== code.toString().trim()) {
      await Otp.findByIdAndUpdate(otp._id, { $inc: { attempts: 1 } });
      const rem = 4 - otp.attempts;
      return res.status(400).json({ message: `Wrong code. ${rem} attempt${rem !== 1 ? 's' : ''} left.` });
    }

    await Otp.findByIdAndUpdate(otp._id, { used: true });

    const user = await User.findByIdAndUpdate(userId, { isVerified: true, isActive: true }, { new: true }).populate('zoneId', 'name');
    if (!user) return res.status(404).json({ message: 'User not found' });

    const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '7d' });
    res.json({
      success: true, token,
      user: buildUserPayload(user),
      message: purpose === 'verify_register' ? 'Account activated! Welcome to ZoneMarket.' : 'Signed in successfully.',
    });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  RESEND OTP
//  POST /api/v1/auth/resend-otp
// ═══════════════════════════════════════════════════════════════════════════════
router.post('/resend-otp', async (req, res) => {
  try {
    const { userId, purpose } = req.body;
    const User = mongoose.model('User');
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const recent = await Otp.findOne({ userId, purpose: purpose || 'verify_login', createdAt: { $gt: new Date(Date.now() - 60000) } });
    if (recent) {
      const wait = Math.ceil((recent.createdAt.getTime() + 60000 - Date.now()) / 1000);
      return res.status(429).json({ message: `Wait ${wait}s before requesting a new code.` });
    }

    await Otp.updateMany({ userId, purpose: purpose || 'verify_login', used: false }, { used: true });
    const code = generateOtp();
    await Otp.create({ userId, phone: user.phone, code, purpose: purpose || 'verify_login', expiresAt: new Date(Date.now() + 20 * 60 * 1000) });
    //await sendSms(user.phone, `ZoneMarket: Your new code is ${code}. Expires in 20 minutes.`);

    res.json({ success: true, message: `New code sent to ${maskPhone(user.phone)} code ${code}` });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  MANAGER: GET MY REFERRAL CODE + CLIENT LIST
//  GET /api/v1/auth/my-referral       (requires auth header)
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/my-referral', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ message: 'Auth required' });
    const decoded = jwt.verify(authHeader.slice(7), JWT_SECRET);

    const User = mongoose.model('User');
    const manager = await User.findById(decoded.id);
    if (!manager) return res.status(404).json({ message: 'User not found' });
    if (manager.role !== 'manager' && manager.role !== 'admin') return res.status(403).json({ message: 'Only managers can access referral codes' });

    let ref = await Referral2.findOne({ managerId: decoded.id })
      .populate('clients.userId', 'name phone walletBalance isActive createdAt');

    if (!ref) {
      // Auto-create referral code if manager doesn't have one
      const code = generateReferralCode(manager.name);

      ref = await Referral2.create({ code, managerId: decoded.id, zoneId: manager.zoneId, zoneName: manager.zoneName || '',});
    }

    const now = Date.now();
    const clientsWithStatus = ref.clients.map(c => {
      const daysSince = c.lastOrderAt
        ? Math.floor((now - new Date(c.lastOrderAt).getTime()) / 86400000)
        : null;
      const isInactive = INACTIVITY_DAYS > 0 && daysSince !== null && daysSince > INACTIVITY_DAYS;
      return {
        userId:      c.userId?._id || c.userId,
        name:        c.name || c.userId?.name || 'Client',
        phone:       c.phone || c.userId?.phone || '—',
        joinedAt:    c.joinedAt,
        lastOrderAt: c.lastOrderAt,
        isActive:    c.isActive,
        isInactive,
        daysSinceOrder: daysSince,
        walletBalance: c.userId?.walletBalance || 0,
      };
    });

    res.json({
      id:           ref._id,
      code:         ref.code,
      isActive:     ref.isActive,
      clients:      clientsWithStatus,
      activeCount:  clientsWithStatus.filter(c => c.isActive && !c.isInactive).length,
      inactiveCount: clientsWithStatus.filter(c => c.isInactive).length,
      totalCount:   clientsWithStatus.length,
    });
  } catch (e) {
    console.error('my-referral error:', e);
    res.status(500).json({ message: e.message });
  }
});

router.post('/referral/refresh-referral-code', async (req, res) => {
  try {
   const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ message: 'Auth required' });
    const decoded = jwt.verify(authHeader.slice(7), JWT_SECRET);
    const {codeId} = req.body;
    const User = mongoose.model('User');
    const manager = await User.findById(decoded.id);
    if (!manager) return res.status(404).json({ message: 'User not found' });
    if (manager.role !== 'manager' && manager.role !== 'admin') return res.status(403).json({ message: 'Only managers can access referral codes' });
    const ref = await Referral2.findOne({ managerId: decoded.id })
      .populate('clients.userId', 'name phone walletBalance isActive createdAt');
    if (ref) {
      // Auto-create referral code if manager doesn't have one
      const code = generateReferralCode(manager.name);
      const newCode = await Referral2.findByIdAndUpdate({ _id: codeId }, { code });
      console.log('Referral code refreshed:', newCode.code);
    res.json({ success: true });
    } else { res.status(404).json({ message: 'Referral code not found' });
    }
  } catch (e) { res.status(500).json({ message: e.message }); }
});
// ═══════════════════════════════════════════════════════════════════════════════
//  MANAGER: SEND REFERRAL CODE VIA SMS to a phone number
//  POST /api/v1/auth/referral/send-sms
// ═══════════════════════════════════════════════════════════════════════════════
router.post('/referral/send-sms', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ message: 'Auth required' });
    const decoded = jwt.verify(authHeader.slice(7), JWT_SECRET);

    const { phone, clientName } = req.body;
    if (!phone) return res.status(400).json({ message: 'Phone number required' });

    const ref = await Referral2.findOne({ managerId: decoded.id, isActive: true });
    if (!ref) return res.status(404).json({ message: 'No referral code found' });

    const User = mongoose.model('User');
    const manager = await User.findById(decoded.id).select('name');

    const msg = `Hi ${clientName || 'there'}! ${manager?.name || 'Your manager'} has invited you to ZoneMarket. Download the app and register with this code: ${ref.code}\n\nThis gives you access to shop in your zone.`;
    await sendSms(phone, msg);

    res.json({ success: true, message: `Invitation sent to ${maskPhone(phone)}`, code: ref.code });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  MANAGER: DEACTIVATE / REACTIVATE a specific client
//  PUT /api/v1/auth/referral/client/:clientId/status
// ═══════════════════════════════════════════════════════════════════════════════
router.put('/referral/client/:clientId/status', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ message: 'Auth required' });
    const decoded = jwt.verify(authHeader.slice(7), JWT_SECRET);

    const { isActive } = req.body;
    await Referral2.findOneAndUpdate(
      { managerId: decoded.id, 'clients.userId': req.params.clientId },
      { $set: { 'clients.$.isActive': isActive } }
    );

    res.json({ success: true, message: `Client ${isActive ? 'reactivated' : 'deactivated'}` });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  UPDATE lastOrderAt when client places an order  (called from server.js)
// ═══════════════════════════════════════════════════════════════════════════════
router.post('/referral/update-activity', async (req, res) => {
  try {
    const { clientId } = req.body;
    await Referral2.findOneAndUpdate(
      { 'clients.userId': clientId },
      { $set: { 'clients.$.lastOrderAt': new Date() } }
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});


module.exports = { router, Otp, Referral2, buildUserPayload, generateReferralCode };
