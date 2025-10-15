require('dotenv').config();
const express = require('express');
const app = express();
const { MongoClient, ServerApiVersion } = require('mongodb');
const morgan = require('morgan');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const port = process.env.port || 10000;

app.use(morgan('dev'));
app.use(express.json());
app.use(cors());

const uri = `mongodb+srv://${process.env.DB_NAME}:${process.env.DB_PASS}@cluster0.wsg3r.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
   serverApi: {
      version: ServerApiVersion.v1,
      strict: true,
      deprecationErrors: true,
   },
});

//::::::::::JWT related API and Middleware
app.post('/jwt', async (req, res) => {
   const { email } = req.body;
   // console.log(email);
   const token = jwt.sign({ email: email }, process.env.JWT_SECRET, {
      expiresIn: '1d',
   });
   res.send({ token });
});

const verifyToken = async (req, res, next) => {
   const accessToken = req.headers.authorization;
   if (!accessToken)
      return res.status(401).send({ message: 'Unauthorize Access!' });
   const token = accessToken?.split(' ')[1];
   if (!token) return res.status(401).send({ message: 'Unauthorize Access!' });
   // Verify Token
   jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
      if (err) {
         return res.status(401).send({ message: 'Unauthorize Access!' });
      }
      req.user = decoded;
      next();
   });
};

async function run() {
   try {
      //:::::Declare all Database collection
      const usersCollection = client.db('ParcelPro').collection('users');
      const parcelsCollection = client.db('ParcelPro').collection('parcels');
      //:::::Middleware using DB

      //:::::All crud operation API

      //// User Related APIs ::::-------------(USER)
      // Save user data in DB when user signup
      app.post('/users', async (req, res) => {
         const userData = req.body;
         // console.log(userData);
         const query = { email: userData.email };

         const user = await usersCollection.findOne(query);
         if (user) return res.send({ message: 'User already exists' });

         const result = await usersCollection.insertOne(userData);
         res.send(result);
      });

      //// Parcel Related APIs ::::-------------(Parcel)

      // Save parcel data in DB
      app.post('/parcels', verifyToken, async (req, res) => {
         const parcelData = req.body;
         console.log(parcelData);
         const result = await parcelsCollection.insertOne(parcelData);
         res.send(result);
      });

      // await client.connect();
      // Send a ping to confirm a successful connection
      // await client.db('admin').command({ ping: 1 });
      console.log(
         'Pinged your deployment. You successfully connected to MongoDB!'
      );
   } finally {
      // Ensures that the client will close when you finish/error
      // await client.close();
   }
}
run().catch(console.dir);

app.get('/', async (req, res) => {
   res.send(`This server is for ParcelPro. A Parcel Management System`);
});

app.listen(port, () => {
   console.log(`My server is now running in port ${port}`);
});
