const express = require("express");
const multer = require("multer");
const cors = require("cors");
const dotenv = require("dotenv");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("cloudinary").v2;

// Load .env
dotenv.config();

// Cloudinary Config
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const app = express();
const port = process.env.PORT || 5001;

app.use(cors());
app.use(express.json());

// ========== Helper functions for JSON in Cloudinary ==========

// Save JSON to Cloudinary
async function saveJsonToCloudinary(publicId, jsonData) {
  const buffer = Buffer.from(JSON.stringify(jsonData, null, 2), "utf-8");
  await cloudinary.uploader.upload_stream(
    {
      public_id: publicId,
      folder: "bstore_data",
      resource_type: "raw",
      overwrite: true,
    },
    (error, result) => {
      if (error) console.error("Cloudinary JSON upload error:", error);
      else console.log(`✅ JSON saved to Cloudinary: ${result.public_id}`);
    }
  ).end(buffer);
}

// Load JSON from Cloudinary
async function loadJsonFromCloudinary(publicId) {
  try {
    const file = await cloudinary.api.resource(`bstore_data/${publicId}`, {
      resource_type: "raw",
    });
    const res = await fetch(file.secure_url);
    return await res.json();
  } catch (err) {
    console.warn(`⚠ JSON ${publicId} not found, returning null`);
    return null;
  }
}

// Ensure JSON exists in Cloudinary
async function ensureJsonExists(publicId, defaultValue) {
  let data = await loadJsonFromCloudinary(publicId);
  if (!data) {
    await saveJsonToCloudinary(publicId, defaultValue);
    return defaultValue;
  }
  return data;
}

// ========== Multer Storage for Product Images ==========
const imageStorage = new CloudinaryStorage({
  cloudinary,
  params: async () => ({
    folder: "bstore_products",
    allowed_formats: ["jpg", "png", "jpeg", "gif"],
    public_id: Date.now().toString(),
  }),
});

const uploadImage = multer({
  storage: imageStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
});

// ========== Multer Storage for QR Codes ==========
const qrStorage = new CloudinaryStorage({
  cloudinary,
  params: async () => ({
    folder: "bstore_qrcodes",
    allowed_formats: ["jpg", "png", "jpeg"],
    public_id: "store_qrcode",
    overwrite: true,
  }),
});
const uploadQR = multer({ storage: qrStorage });

// ========== ROUTES ==========

// Upload QR Code
app.post("/upload-qrcode", uploadQR.single("qrCode"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No QR code uploaded" });

  const settings = { qrCodeUrl: req.file.path, cloudinaryId: req.file.filename };
  await saveJsonToCloudinary("settings", settings);
  res.json({ success: true, message: "QR Code updated", ...settings });
});

// Get QR Code settings
app.get("/settings", async (req, res) => {
  const settings = await ensureJsonExists("settings", { qrCodeUrl: "" });
  res.json(settings);
});

// Upload Receipt
app.post("/upload", uploadImage.single("receipt"), async (req, res) => {
  let { total, timestamp, note, cname, orderId, paymentMethod, cartItems } = req.body;

  try {
    cartItems = JSON.parse(cartItems);
  } catch {
    cartItems = [];
  }

  const minimalCartItems = cartItems.map(item => ({
    id: item.id,
    name: item.name,
    price: item.price,
    quantity: item.quantity,
  }));

  const receiptMeta = {
    orderId: orderId || "ORD" + Date.now(),
    cname: cname || "",
    note: note || "",
    total: total || "0.00",
    paymentMethod: paymentMethod || "",
    uploadedAt: timestamp || new Date().toISOString(),
    cartItems: minimalCartItems,
  };

  if (req.file) {
    receiptMeta.receiptUrl = req.file.path;
    receiptMeta.cloudinaryId = req.file.filename;
  }

  let receipts = await ensureJsonExists("receipts", []);
  receipts.unshift(receiptMeta);
  await saveJsonToCloudinary("receipts", receipts);

  res.json({ message: "Receipt saved", receipt: receiptMeta });
});

// Get Receipts
app.get("/receipts", async (req, res) => {
  const receipts = await ensureJsonExists("receipts", []);
  res.json(receipts);
});


// Delete Receipt
app.delete("/receipts/:orderId", async (req, res) => {
  let receipts = await ensureJsonExists("receipts", []);
  const index = receipts.findIndex(r => r.orderId === req.params.orderId);

  if (index === -1) {
    return res.status(404).json({ error: "Receipt not found" });
  }

  receipts.splice(index, 1);
  await saveJsonToCloudinary("receipts", receipts);

  res.json({ message: "Receipt deleted", orderId: req.params.orderId });
});


//Product API

// Get Products
app.get("/products", async (req, res) => {
  const products = await ensureJsonExists("products", []);
  res.json(products);
});

// Add Product
app.post("/products", uploadImage.single("image"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Image is required" });

  let products = await ensureJsonExists("products", []);

  const newProduct = {
    id: Date.now(),
    name: req.body.name,
    price: req.body.price,
    description: req.body.description,
    imageUrl: req.file.path,
    cloudinaryId: req.file.filename,
  };

  products.push(newProduct);
  await saveJsonToCloudinary("products", products);

  res.json({ message: "Product added", product: newProduct });
});

// Update Product
app.put("/products/:id", uploadImage.single("image"), async (req, res) => {
  let products = await ensureJsonExists("products", []);
  const index = products.findIndex(p => p.id === parseInt(req.params.id));
  if (index === -1) return res.status(404).json({ error: "Product not found" });

  if (req.file) {
    if (products[index].cloudinaryId) {
      await cloudinary.uploader.destroy(products[index].cloudinaryId);
    }
    products[index].imageUrl = req.file.path;
    products[index].cloudinaryId = req.file.filename;
  }

  products[index].name = req.body.name || products[index].name;
  products[index].price = req.body.price || products[index].price;
  products[index].description = req.body.description || products[index].description;

  await saveJsonToCloudinary("products", products);
  res.json({ message: "Product updated", product: products[index] });
});

// Delete Product
app.delete("/products/:id", async (req, res) => {
  let products = await ensureJsonExists("products", []);
  const index = products.findIndex(p => p.id === parseInt(req.params.id));
  if (index === -1) return res.status(404).json({ error: "Product not found" });

  const product = products[index];
  if (product.cloudinaryId) {
    await cloudinary.uploader.destroy(product.cloudinaryId, {
      resource_type: "image",
      invalidate: true,
    });
  }

  products.splice(index, 1);
  await saveJsonToCloudinary("products", products);

  res.json({ message: "Product deleted" });
});

// Root
app.get("/", (req, res) => {
  res.send("B-Store Server is running 🚀");
});

app.listen(port, () => console.log(`Server running on port ${port}`));
