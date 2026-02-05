import mongoose from 'mongoose';

const connectDB = async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri || typeof uri !== 'string') {
    const msg = 'MONGODB_URI is not set. On Railway: Variables → add MONGODB_URI, then redeploy.';
    console.error(msg);
    throw new Error(msg);
  }
  const conn = await mongoose.connect(uri);
  console.log(`MongoDB Connected: ${conn.connection.host}`);
};

export default connectDB;
