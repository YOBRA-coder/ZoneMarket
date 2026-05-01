const AfricasTalking = require("africastalking")({
  apiKey: process.env.AT_API_KEY,
  username: process.env.AT_USERNAME
});

const sms = AfricasTalking.SMS;

exports.sendSMS = async (phone, message) => {
  await sms.send({
    to: [phone],
    message
  });
};