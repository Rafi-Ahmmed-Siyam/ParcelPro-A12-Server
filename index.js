require('dotenv').config();
const express = require('express');
const app = express();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
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
      const verifyAdmin = async (req, res, next) => {
         const jwtUserEmail = req.user.email;
         const query = { email: jwtUserEmail };
         const user = await usersCollection.findOne(query);

         if (!user && user.role !== 'Admin')
            return res
               .status(403)
               .send({ message: 'Forbidden Access! Admin Only Actions!' });
         next();
      };
      const verifyDeliveryMan = async (req, res, next) => {
         const jwtUserEmail = req.user.email;
         const query = { email: jwtUserEmail };
         const user = await usersCollection.findOne(query);

         if (!user && user.role !== 'DeliveryMen')
            return res
               .status(403)
               .send({ message: 'Forbidden Access! Admin Only Actions!' });
         next();
      };

      //:::::All crud operation API

      //// User Related APIs ::::-------------(USER)
      // Get user role
      app.get('/users/role/:email', async (req, res) => {
         const email = req.params.email;
         const result = await usersCollection.findOne({ email });
         res.send({ role: result?.role });
      });

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

      // Get All userData  by ADMIN
      app.get('/users', verifyToken, verifyAdmin, async (req, res) => {
         const result = await usersCollection
            .aggregate([
               {
                  $lookup: {
                     from: 'parcels',
                     localField: 'email',
                     foreignField: 'senderEmail',
                     as: 'parcelData',
                  },
               },

               {
                  $addFields: {
                     parcelsBooked: { $size: '$parcelData' },
                     phone: {
                        $ifNull: [{ $first: '$parcelData.senderPhone' }, null],
                     },
                  },
               },
               {
                  $unwind: {
                     path: '$parcelData',
                     preserveNullAndEmptyArrays: true,
                  },
               },
               {
                  $group: {
                     _id: {
                        _id: '$_id',
                        name: '$name',
                        email: '$email',
                        phone: '$phone',
                        parcelsBooked: '$parcelsBooked',
                     },
                     totalCost: { $sum: { $ifNull: ['$parcelData.price', 0] } },
                  },
               },
               {
                  $project: {
                     _id: 0,
                     _id: '$_id._id',
                     name: '$_id.name',
                     email: '$_id.email',
                     phone: '$_id.phone',
                     parcelsBooked: '$_id.parcelsBooked',
                     totalCost: 1,
                  },
               },
            ])
            .toArray();

         res.send(result);
      });

      //// Parcel Related APIs ::::-------------(Parcel)

      // Save parcel data in DB
      app.post('/parcels', verifyToken, async (req, res) => {
         const parcelData = req.body;
         // console.log(parcelData);
         const result = await parcelsCollection.insertOne(parcelData);
         res.send(result);
      });

      // Get all Parcel data for Admin
      app.get('/parcels/admin', verifyToken, verifyAdmin, async (req, res) => {
         const result = await parcelsCollection.find().toArray();
         res.send(result);
      });

      // Get specific parcel data for user and Filter parcel by ststus
      app.get('/parcels', verifyToken, async (req, res) => {
         const email = req.query.email;
         const jwtEmail = req.user.email;
         const status = req.query.status;
         // console.log(email, status);

         if (jwtEmail !== email)
            return res
               .status(403)
               .send({ message: 'Forbidden Access! Email Not Match!' });

         let query = { senderEmail: email };
         if (status !== 'all') query.bookingStatus = status;

         const result = await parcelsCollection.find(query).toArray();
         res.send(result);
      });

      // Get a single parcel data
      app.get('/parcels/:id', verifyToken, async (req, res) => {
         const id = req.params.id;
         const query = { _id: new ObjectId(id) };
         const result = await parcelsCollection.findOne(query);
         res.send(result);
      });

      // Delete parcel data by user
      app.delete('/parcels/:id', verifyToken, async (req, res) => {
         const id = req.params.id;
         console.log(id);
         const query = { _id: new ObjectId(id) };
         const result = await parcelsCollection.deleteOne(query);
         res.send(result);
      });

      // Update user parcel data
      app.put('/parcels/:id', verifyToken, async (req, res) => {
         const id = req.params.id;
         const updateData = req.body;
         const filter = { _id: new ObjectId(id) };
         const updateDoc = {
            $set: updateData,
         };

         const result = await parcelsCollection.updateOne(filter, updateDoc);
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
