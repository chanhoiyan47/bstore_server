const express = require("express");
const multer = require("multer");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("cloudinary").v2;

// Load .env
dotenv.config();

// Cloudinary 設定
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const app = express();
const port = process.env.PORT || 5001;

app.use(cors());
app.use(express.json());

// Cloudinary Storage 設定
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    return {
      folder: "bstore_products", // folder in Cloudinary
      allowed_formats: ["jpg", "png", "jpeg", "gif"],
      public_id: Date.now().toString(), // unique name for image
    };
  },
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024,
    fieldSize: 5 * 1024 * 1024,
  },
});

// Path to store QR code settings
const settingsPath = path.join(__dirname, "settings.json");
if (!fs.existsSync(settingsPath)) {
  fs.writeFileSync(settingsPath, JSON.stringify({ qrCodeUrl: "" }, null, 2));
}

// Cloudinary Storage for QR code
const qrStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    return {
      folder: "bstore_qrcodes",
      allowed_formats: ["jpg", "png", "jpeg"],
      public_id: "store_qrcode", // keep the same so new upload replaces old
      overwrite: true
    };
  },
});
const uploadQR = multer({ storage: qrStorage });

// Upload QR code
app.post("/upload-qrcode", uploadQR.single("qrCode"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No QR code image uploaded" });
  }

  const settings = {
    qrCodeUrl: req.file.path, // Cloudinary secure URL
    cloudinaryId: req.file.filename
  };

  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  res.json({ success: true, message: "QR Code updated", ...settings });
});

// Get current QR code
app.get("/settings", (req, res) => {
  if (!fs.existsSync(settingsPath)) {
    return res.json({ qrCodeUrl: "" });
  }
  const settings = JSON.parse(fs.readFileSync(settingsPath));
  res.json(settings);
});


// API to upload receipt
app.post("/upload", upload.single("receipt"), (req, res) => {
  let { total, timestamp, note, cname, orderId, paymentMethod, cartItems } = req.body;

  // Parse cartItems from string to array
  try {
    cartItems = JSON.parse(cartItems); // from frontend multipart/form-data
  } catch (err) {
    cartItems = [];
  }

  const minimalCartItems = cartItems.map(item => ({
    id: item.id,
    name: item.name,
    price: item.price,
    quantity: item.quantity
  }));

  const receiptMeta = {
    orderId: orderId || "ORD" + Date.now(),
    cname: cname || "",
    note: note || "",
    total: total || "0.00",
    paymentMethod: paymentMethod || "",
    uploadedAt: timestamp || new Date().toISOString(),
    cartItems: minimalCartItems
  };

  // Add image info only if it's a receipt upload
  if (req.file) {
    receiptMeta.receiptUrl = req.file.path;       // Cloudinary URL
    receiptMeta.cloudinaryId = req.file.filename; // Cloudinary ID
  }

  const dataPath = path.join(__dirname, "receipts.json");
  let existing = [];
  if (fs.existsSync(dataPath)) {
    existing = JSON.parse(fs.readFileSync(dataPath));
  }

  // Put newest on top
  existing.unshift(receiptMeta);

  fs.writeFileSync(dataPath, JSON.stringify(existing, null, 2));

  res.json({
    message: "Receipt data saved",
    receipt: receiptMeta
  });
});


// Get all receipts
app.get("/receipts", (req, res) => {
  const dataPath = path.join(__dirname, "receipts.json");
  if (!fs.existsSync(dataPath)) {
    return res.json([]);
  }

  const rawData = fs.readFileSync(dataPath);
  try {
    const receipts = JSON.parse(rawData);
    res.json(receipts);
  } catch (err) {
    res.status(500).json({ error: "Failed to parse receipts.json" });
  }
});


// Path to store product data
const productsPath = path.join(__dirname, "products.json");
if (!fs.existsSync(productsPath)) {
  fs.writeFileSync(productsPath, JSON.stringify([], null, 2));
}

// ====== Routes ======

// Get all products
app.get("/products", (req, res) => {
  const products = JSON.parse(fs.readFileSync(productsPath));
  res.json(products);
});


// Add new product with image upload
app.post("/products", upload.single("image"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Image file is required" });
  }

  const products = JSON.parse(fs.readFileSync(productsPath));

  const newProduct = {
    id: Date.now(),
    name: req.body.name,
    price: req.body.price,
    description: req.body.description,
    imageUrl: req.file.path, // secure URL
    cloudinaryId: req.file.filename, // public_id with folder
  };

  products.push(newProduct);
  fs.writeFileSync(productsPath, JSON.stringify(products, null, 2));

  res.json({ message: "Product added", product: newProduct });
});




// Update product info (with optional image upload)
app.put("/products/:id", upload.single("image"), async (req, res) => {
  const { id } = req.params;
  let products = JSON.parse(fs.readFileSync(productsPath));
  const index = products.findIndex(p => p.id === parseInt(id));
  if (index === -1) return res.status(404).json({ error: "Product not found" });

  if (req.file) {
    // Delete old image
    if (products[index].cloudinaryId) {
      await cloudinary.uploader.destroy(products[index].cloudinaryId);
    }
    products[index].imageUrl = req.file.path;
    products[index].cloudinaryId = req.file.filename;
  }

  products[index].name = req.body.name || products[index].name;
  products[index].price = req.body.price || products[index].price;
  products[index].description = req.body.description || products[index].description;

  fs.writeFileSync(productsPath, JSON.stringify(products, null, 2));
  res.json({ message: "Product updated", product: products[index] });
});



// Delete product (and image from Cloudinary)
app.delete("/products/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const raw = fs.readFileSync(productsPath, "utf8");
  const products = raw ? JSON.parse(raw) : [];
  const index = products.findIndex(p => p.id === id);
  if (index === -1) {
    return res.status(404).json({ error: "Product not found" });
  }

  const product = products[index];
  const originalId = product.cloudinaryId || "";
  let publicId = originalId.replace(/\.[^/.]+$/, ""); // strip extension

  if (!publicId.includes("/")) {
    // ensure matches multer-storage folder
    publicId = `bstore_products/${publicId}`;
  }

  console.log("Attempting to delete Cloudinary public_id:", publicId);

  try {
    const result = await cloudinary.uploader.destroy(publicId, {
      resource_type: "image",
      invalidate: true
    });
    console.log("Destroy result:", result);
  } catch (err) {
    console.error("Cloudinary delete error:", err);
  }

  products.splice(index, 1);
  fs.writeFileSync(productsPath, JSON.stringify(products, null, 2));
  res.json({ message: "Product deleted" });
});


app.get('/', (req, res) => {
  res.send('B-Store Server is running 🚀');
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
