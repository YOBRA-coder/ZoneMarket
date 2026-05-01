// backend/scripts/seed.js
// Run: node scripts/seed.js
const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const URI = 'mongodb+srv://brianrotich909_db_user:R86q2IGJdyWj777t@cluster0.3iyvfrr.mongodb.net/?appName=Cluster0';

const UserSchema = new mongoose.Schema({ name:String, email:String, password:String, phone:String, role:String, zoneId:mongoose.Schema.Types.ObjectId, walletBalance:{type:Number,default:0}, adminCommission:{type:Number,default:0}, totalEarnings:{type:Number,default:0}, isActive:{type:Boolean,default:true}, isVerified:{type:Boolean,default:true} }, { timestamps:true });
const ZoneSchema = new mongoose.Schema({ name:String, description:String, center:{lat:Number,lng:Number}, radius:{type:Number,default:5000}, isActive:{type:Boolean,default:true} });
const ProductSchema = new mongoose.Schema({ name:String, description:String, price:Number, originalPrice:Number, discount:Number, stock:Number, category:String, images:[String], managerId:mongoose.Schema.Types.ObjectId, zoneId:mongoose.Schema.Types.ObjectId, likes:[mongoose.Schema.Types.ObjectId], isNew:{type:Boolean,default:false}, isHot:{type:Boolean,default:false}, hasPromotion:{type:Boolean,default:false}, isActive:{type:Boolean,default:true} }, { timestamps:true });

async function seed() {
  await mongoose.connect(URI);
  console.log('🔗 Connected to MongoDB');

  //await mongoose.connection.dropDatabase();
  //console.log('🗑️  Database cleared');

  const User    = mongoose.model('User',    UserSchema);
 // const Zone    = mongoose.model('Zone',    ZoneSchema);
 // const Product = mongoose.model('Product', ProductSchema);

  const hash = (p) => bcrypt.hash(p, 12);

  // Admin
  const admin = await User.create({ name:'Super Admin', email:'Admin@zonemarket.com', password:await hash('Admin@2024'), phone:'0748175488', role:'admin', adminCommission:0, walletBalance:0 });

  // Zones
 // const zoneA = await Zone.create({ name:'Zone A', description:'Section 58, Nakuru', center:{ lat:0.2850, lng:36.0900 }, radius:3000 });
 // const zoneB = await Zone.create({ name:'Zone B', description:'Mawanga, Nakuru', center:{ lat:0.2726, lng:36.1132 }, radius:3000 });
 // const zoneC = await Zone.create({ name:'Zone C', description:'Nakuru CBD, Nakuru', center:{ lat:0.2833, lng:36.0667 }, radius:4000 });

  // Managers
//  const james  = await User.create({ name:'James Mwangi', email:'james@zonemarket.com', password:await hash('Manager@2024'), phone:'0712345678', role:'manager', zoneId:zoneA._id, walletBalance:12400, totalEarnings:84000 });
 // const sarah  = await User.create({ name:'Sarah Odhiambo', email:'sarah@zonemarket.com', password:await hash('Manager@2024'), phone:'0798765432', role:'manager', zoneId:zoneB._id, walletBalance:8200, totalEarnings:56000 });
 // const peter  = await User.create({ name:'Peter Kamau', email:'peter@zonemarket.com', password:await hash('Manager@2024'), phone:'0733111222', role:'manager', zoneId:zoneC._id, walletBalance:6100, totalEarnings:42000 });

  // Clients
 // const alice  = await User.create({ name:'Alice Njeri', email:'alice@gmail.com', password:await hash('Client@2024'), phone:'0722111222', role:'client', zoneId:zoneA._id, walletBalance:5200 });
 // const bob    = await User.create({ name:'Bob Kamau',   email:'bob@gmail.com',   password:await hash('Client@2024'), phone:'0744333444', role:'client', zoneId:zoneA._id, walletBalance:1800 });
  //const carol  = await User.create({ name:'Carol W.',    email:'carol@gmail.com', password:await hash('Client@2024'), phone:'0711555666', role:'client', zoneId:zoneB._id, walletBalance:3200 });

  // Products for Zone A (James)
 
 // await Product.insertMany(zoneBProds.map(p => ({ ...p, managerId:sarah._id, zoneId:zoneB._id })));

  console.log('\n✅ Seed complete! Demo accounts:\n');
  console.log('  👑 Admin:   admins@zonemarket.com   / Admin@2024'+admin.phone);
  //console.log('  🏪 Manager: james@zonemarket.com   / Manager@2024  (Zone A)');
 // console.log('  🏪 Manager: sarah@zonemarket.com   / Manager@2024  (Zone B)');
 // console.log('  🛒 Client:  alice@gmail.com         / Client@2024   (Zone A)');
  //console.log('  🛒 Client:  bob@gmail.com           / Client@2024   (Zone A)\n');

  await mongoose.connection.close();
  process.exit(0);
}

seed().catch(e => { console.error('❌ Seed failed:', e); process.exit(1); });
