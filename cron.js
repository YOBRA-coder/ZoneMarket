const cron = require("node-cron");
const User = require("./models/User");

cron.schedule("0 0 * * *", async () => {
  const limit = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  await User.deleteMany({
    isRegistered: false,
    createdAt: { $lt: limit }
  });

  console.log("Dormant users cleared");
});