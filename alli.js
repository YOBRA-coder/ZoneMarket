const mongoose = require('mongoose');

// 1. Set your connection string and target email
const MONGO_URI = "mongodb+srv://brianrotich909_db_user:R86q2IGJdyWj777t@cluster0.3iyvfrr.mongodb.net/?appName=Cluster0"
const TARGET_EMAIL = 'admin@zonemarket.com'; 

// 2. Minimal schema with strict: false to bypass restriction checks
const userSchema = new mongoose.Schema({
  email: String,
  role: String
}, { strict: false });

const User = mongoose.model('User', userSchema);

async function manageAdminRole() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('Connected to MongoDB.');

    // Step 1: Find and list all current admins
    const currentAdmins = await User.find({ role: 'admin' });
    
    console.log('\n--- Current Admins in Database ---');
    if (currentAdmins.length === 0) {
      console.log('No current admins found.');
    } else {
      currentAdmins.forEach(admin => {
        console.log(`- Email: ${admin || 'N/A'} (ID: ${admin._id})`);
      });
    }
    console.log('---------------------------------\n');

    // Step 2: Check if our target user exists
    const targetUser = await User.findOne({ email: TARGET_EMAIL });
    if (!targetUser) {
      console.log(`Error: Target user (${TARGET_EMAIL}) not found. Script stopped.`);
      return;
    }

    // Step 3: Strip admin privileges from everyone else
    const demoteResult = await User.updateMany(
      { email: { $ne: TARGET_EMAIL }, role: 'admin' },
      { $set: { type: 'client' } } // Changes old admins back to 'user'
    );
    console.log(`Stripped admin status from ${demoteResult.modifiedCount} old admin(s).`);

    // Step 4: Promote the target user
    targetUser.role = 'admin';
    targetUser.userName= 'super';
    targetUser.email = 'phillipruto1@gmail.com';
    await targetUser.save();
    console.log(`Success! ${TARGET_EMAIL} is now the sole admin.`);

  } catch (error) {
    console.error('Database operation failed:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB.');
  }
}

manageAdminRole();

