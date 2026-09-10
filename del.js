const mongoose = require('mongoose');

// 1. CHANGE THIS: Replace with your actual MongoDB connection string
const MONGO_URI = "mongodb+srv://brianrotich909_db_user:R86q2IGJdyWj777t@cluster0.3iyvfrr.mongodb.net/?appName=Cluster0"

// 2. Define a minimal schema so Mongoose knows how to interact with the collection
const userSchema = new mongoose.Schema({
    email: { type: String, required: true }
}, { strict: false }); // strict: false allows interacting with fields not explicitly defined here

const User = mongoose.model('User', userSchema);

async function deleteUserByEmail(emailTarget) {
    try {
        // Connect to MongoDB
        await mongoose.connect(MONGO_URI);
        console.log('Successfully connected to MongoDB.');

        // Format the email to lower case to prevent mismatch issues
        const formattedEmail = emailTarget.trim().toLowerCase();

        // 3. Perform the deletion 
        // Use deleteMany if you want to wipe all duplicates, or deleteOne for just the first match
        const result = await User.deleteMany({ email: formattedEmail });

        if (result.deletedCount > 0) {
            console.log(`Success: Deleted ${result.deletedCount} user(s) with email: ${formattedEmail}`);
        } else {
            console.log(`No user found with the email: ${formattedEmail}`);
        }

    } catch (error) {
        console.error('An error occurred during deletion:', error);
    } finally {
        // Always disconnect when the script finishes execution
        await mongoose.disconnect();
        console.log('Disconnected from MongoDB.');
    }
}

// 4. CHANGE THIS: Provide the email address you want to delete
const targetEmail = 'samson@gmail.com'; 

deleteUserByEmail(targetEmail);
