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
      const reviewsCollection = client.db('ParcelPro').collection('reviews');
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
               .send({ message: 'Forbidden Access! Delivery Man Actions!' });
         next();
      };

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

      // Get user role
      app.get('/users/role/:email', verifyToken, async (req, res) => {
         const email = req.params.email;
         const result = await usersCollection.findOne({ email });

         if (!result) {
            return res.status(404).send({ message: 'User not found' });
         }
         if (result.role === 'DeliveryMen' && !result.phone) {
            return res.send({
               role: result?.role,
               verified: false,
               id: result._id,
            });
         }
         return res.send({
            role: result?.role,
            verified: true,
            id: result?._id,
         });
      });

      // Get All userData  by ADMIN {Pagination}
      app.get('/users/admin', verifyToken, verifyAdmin, async (req, res) => {
         const currentPage = parseInt(req.query.currentPage);
         const limit = parseInt(req.query.limit);
         const skip = (currentPage - 1) * limit;
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
                        role: '$role',
                        createdAt: '$createdAt',
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
                     role: '$_id.role',
                     parcelsBooked: '$_id.parcelsBooked',
                     createdAt: '$_id.createdAt',
                     totalCost: 1,
                  },
               },
               {
                  $sort: {
                     createdAt: -1,
                  },
               },
               {
                  $skip: skip,
               },
               {
                  $limit: limit,
               },
            ])
            .toArray();

         res.send(result);
      });

      // Get all user count for Pagination
      app.get('/users/count', verifyToken, verifyAdmin, async (req, res) => {
         const totalUser = await usersCollection.estimatedDocumentCount();
         res.send({ totalCount: totalUser });
      });

      // Change User Role by admin
      app.patch('/users/role', verifyToken, verifyAdmin, async (req, res) => {
         const { id, role } = req.body;
         console.log(id, role);
         const query = { _id: new ObjectId(id) };
         const updateDoc = {
            $set: { role },
         };
         const result = await usersCollection.updateOne(query, updateDoc);
         res.send(result);
      });

      // Get all deliveryMen by  Admin------>
      app.get(
         '/users/deliveryMen',
         verifyToken,
         verifyAdmin,
         async (req, res) => {
            const query = { role: 'DeliveryMen' };
            const result = await usersCollection.find(query).toArray();
            res.send(result);
         }
      );

      //------------? Delivery man PAIs
      // Add a number if deliveryman is not set a number
      app.patch(
         '/deliveryman',
         verifyToken,
         verifyDeliveryMan,
         async (req, res) => {
            const { id, phone } = req.body;
            console.log(id, phone);
            const query = { _id: new ObjectId(id) };
            const updateDoc = {
               $set: { phone },
            };
            const result = await usersCollection.updateOne(query, updateDoc);
            res.send(result);
         }
      );

      // Get all Deliveries for specific [DeliveryMam]
      app.get(
         '/deliveries/:id',
         verifyToken,
         verifyDeliveryMan,
         async (req, res) => {
            const id = req.params.id;
            const query = {
               deliveryManId: id,
            };
            const result = await parcelsCollection.find(query).toArray();
            res.send(result);
         }
      );

      // Update delivery status by deliveryman
      app.patch(
         '/deliveries',
         verifyToken,
         verifyDeliveryMan,
         async (req, res) => {
            const { parcelId, status, deliveryMenId } = req.body;
            console.log(parcelId, status, deliveryMenId);

            if (status === 'Delivered') {
               const userFilter = { _id: new ObjectId(deliveryMenId) };
               await usersCollection.updateOne(userFilter, {
                  $inc: { deliveredCount: 1 },
               });
            }

            const filter = { _id: new ObjectId(parcelId) };
            const updateDoc = {
               $set: {
                  bookingStatus: status,
               },
            };

            const result = await parcelsCollection.updateOne(filter, updateDoc);
            res.send(result);
         }
      );

      //// Parcel Related APIs ::::-------------(Parcel)
      // Save parcel data in DB
      app.post('/parcels', verifyToken, async (req, res) => {
         const parcelData = req.body;
         // console.log(parcelData);
         const result = await parcelsCollection.insertOne(parcelData);
         res.send(result);
      });

      // Get all Parcel data by Admin
      app.get('/parcels/admin', verifyToken, verifyAdmin, async (req, res) => {
         const fromDate = req.query.fromDate;
         const toDate = req.query.toDate;
         console.log(fromDate);
         console.log(toDate);

         let query = {};
         if (fromDate && toDate) {
            query = {
               deliveryDate: {
                  $gte: fromDate,
                  $lte: toDate,
               },
            };
         }

         const result = await parcelsCollection
            .find(query)
            .sort({
               createdAt: -1,
            })
            .toArray();
         res.send(result);
      });

      // Get specific parcel data for user and Filter parcel by status
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

         const result = await parcelsCollection
            .find(query)
            .sort({
               createdAt: -1,
            })
            .toArray();
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

      // Assign a delivery man for Parcel by ADMIN
      app.patch(
         '/parcels/assign',
         verifyToken,
         verifyAdmin,
         async (req, res) => {
            const { parcelId, deliveryManId, approxDeliveryDate } = req.body;
            const filter = { _id: new ObjectId(parcelId) };
            const updateDoc = {
               $set: {
                  deliveryManId,
                  approxDeliveryDate,
                  bookingStatus: 'On The Way',
               },
            };
            //
            const result = await parcelsCollection.updateOne(filter, updateDoc);
            res.send(result);
         }
      );

      // rating and feedback related apis
      // get a deliveryMan data by id this is for user can show who delivered parcel for him/her
      app.get('/deliveryMen/:id', verifyToken, async (req, res) => {
         const id = req.params.id;
         const query = { _id: new ObjectId(id) };
         const result = await usersCollection.findOne(query);
         res.send(result);
      });

      // Save a user feedback in feedback collection
      app.post('/reviews', verifyToken, async (req, res) => {
         const feedbackData = req.body;
         const result = await reviewsCollection.insertOne(feedbackData);
         res.send(result);
      });

      // Get review for specific deliveryMen
      app.get(
         '/reviews/:id',
         verifyToken,
         verifyDeliveryMan,
         async (req, res) => {
            const id = req.params.id;
            const query = { deliveryMenId: id };
            const result = await reviewsCollection.find(query).toArray();
            res.send(result);
         }
      );

      // Give review by user

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
