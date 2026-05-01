const mongoose = require('mongoose');

const getDashboardAnalytics = async (req, res) => {
  try {
    const { managerId, zoneId } = req.query;

    // 🔒 Build dynamic filter
    const matchFilter = {
      status: 'delivered'
    };

    if (managerId && mongoose.Types.ObjectId.isValid(managerId)) {
      matchFilter.managerId = new mongoose.Types.ObjectId(managerId);
    }

    if (zoneId && mongoose.Types.ObjectId.isValid(zoneId)) {
      matchFilter.zoneId = new mongoose.Types.ObjectId(zoneId);
    }

    // 📅 Dates
    const now = new Date();

    // Week (Mon → Sun)
    const startOfWeek = new Date();
    startOfWeek.setHours(0, 0, 0, 0);
    const day = startOfWeek.getDay();
    const diff = startOfWeek.getDate() - day + (day === 0 ? -6 : 1);
    startOfWeek.setDate(diff);

    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 7);

    // Month
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    // Year
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const endOfYear = new Date(now.getFullYear() + 1, 0, 1);

    // 🔥 Run all aggregations in parallel
    const [weekly, monthly, yearly, summary] = await Promise.all([

      // 📊 WEEKLY (daily)
      Order.aggregate([
        { $match: { ...matchFilter, createdAt: { $gte: startOfWeek, $lt: endOfWeek } } },
        {
          $group: {
            _id: {
              $dateToString: {
                format: "%Y-%m-%d",
                date: "$createdAt",
                timezone: "Africa/Nairobi"
              }
            },
            orders: { $sum: 1 },
            revenue: { $sum: "$total" }
          }
        },
        { $sort: { _id: 1 } }
      ]),

      // 📊 MONTHLY (daily)
      Order.aggregate([
        { $match: { ...matchFilter, createdAt: { $gte: startOfMonth, $lt: endOfMonth } } },
        {
          $group: {
            _id: {
              $dateToString: {
                format: "%Y-%m-%d",
                date: "$createdAt",
                timezone: "Africa/Nairobi"
              }
            },
            orders: { $sum: 1 },
            revenue: { $sum: "$total" }
          }
        },
        { $sort: { _id: 1 } }
      ]),

      // 📈 YEARLY (monthly)
      Order.aggregate([
        { $match: { ...matchFilter, createdAt: { $gte: startOfYear, $lt: endOfYear } } },
        {
          $group: {
            _id: {
              $dateToString: {
                format: "%Y-%m",
                date: "$createdAt",
                timezone: "Africa/Nairobi"
              }
            },
            orders: { $sum: 1 },
            revenue: { $sum: "$total" }
          }
        },
        { $sort: { _id: 1 } }
      ]),

      // 💰 SUMMARY (this month)
      Order.aggregate([
        { $match: { ...matchFilter, createdAt: { $gte: startOfMonth, $lt: endOfMonth } } },
        {
          $group: {
            _id: null,
            totalOrders: { $sum: 1 },
            totalRevenue: { $sum: "$total" },
            avgOrderValue: { $avg: "$total" }
          }
        }
      ])
    ]);

    // 🧠 Normalize summary
    const summaryData = summary[0] || {
      totalOrders: 0,
      totalRevenue: 0,
      avgOrderValue: 0
    };

    res.json({
      filters: { managerId, zoneId },
      weekly,
      monthly,
      yearly,
      summary: summaryData
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Analytics error' });
  }
};