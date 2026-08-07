const express = require("express");
const PDFDocument = require("pdfkit");
const bwipjs = require("bwip-js");
const QRCode = require("qrcode");
const fs = require("fs");
const cors = require("cors");
const axios = require("axios");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());

// Constants
const PDF_DIR = "awb_pdfs";
const DEFAULT_API_KEY = "";
const PDF_SIZE = [100, 150]; // width, height in mm
const FONTS = {
  bold: path.join(__dirname, "./sans-bld.otf"),
  regular: path.join(__dirname, "./sans-reg.otf"),
};

// Logos
const LOGOS = {
  vtp: path.join(__dirname, "./logos/vtp.png"),
  ghn: path.join(__dirname, "./logos/ghn.png"),
  spx: path.join(__dirname, "./logos/spx.png"), // Added for Shopee Xpress
  default: path.join(__dirname, "./logos/default.png"),
};

// Ensure PDF directory exists
if (!fs.existsSync(PDF_DIR)) {
  fs.mkdirSync(PDF_DIR, { recursive: true });
}

const mmToPoints = (mm) => mm * 2.83; // Convert mm to PDF points

// Improved error handling for order ID parsing
const parseOrderId = (combinedOrderId) => {
  if (!combinedOrderId || typeof combinedOrderId !== "string") {
    throw new Error("Invalid or missing orderId");
  }

  const parts = combinedOrderId.split("_");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error("orderId must be in the format shopId_orderId");
  }

  return { shopId: parts[0], orderId: parts[1] };
};

// Enhanced API client with timeout and better error handling
const getPartnerData = async (shopId, orderId, apiKey) => {
  try {
    const response = await axios.get(
      `https://pos.pages.fm/api/v1/shops/${shopId}/orders/${orderId}`,
      {
        params: { api_key: apiKey },
        timeout: 5000, // 5 second timeout
      }
    );

    if (!response.data || !response.data.data) {
      throw new Error("Invalid response structure from API");
    }

    return response.data;
  } catch (error) {
    const errorMsg = error.response
      ? `API responded with ${error.response.status}: ${error.response.data?.message || "No details"
      }`
      : error.message;
    throw new Error(`Failed to fetch partner data: ${errorMsg}`);
  }
};

// Helper function to determine logo based on partner_id
const getLogoPath = (partnerData) => {
  const partnerId = partnerData?.partner_id || "default";
  console.log(partnerId);
  // Map partner_id to logo
  const logoMap = {
    42: LOGOS.spx, // Shopee Xpress (based on API response)
    // Add partner_id for vtp and ghn (replace with actual IDs from your API)
    3: LOGOS.vtp, // Placeholder for vtp (update with correct partner_id)
    2: LOGOS.ghn, // Placeholder for ghn (update with correct partner_id)
  };

  return logoMap[partnerId] || LOGOS.default; // Fallback to default logo
};

// Improved PDF generation with dynamic logo
const generateAWBPDF = async (shopId, orderId, apiKey, extra = "") => {
  let doc;
  let writeStream;

  try {
    // Fetch partner data
    const data = await getPartnerData(shopId, orderId, apiKey);

    // Safely extract data with defaults
    const partner = data.data?.partner || {};
    const items = data.data?.items || [];
    const servicePartner = partner.service_partner || {};
    const warehouseInfo = data.data?.warehouse_info || {};
    const shippingAddress = data.data?.shipping_address || {};

    // Determine logo dynamically
    const logoPath = getLogoPath(partner);

    // Process items
    const itemsSKUandQuantity = items.map((item) => ({
      sku: item?.variation_info?.display_id || "***",
      quantity: item?.quantity || 0,
    }));

    // Extract fields with defaults
    const trackingCode =
      partner.order_number_vtp || partner.extend_code || "***";
    const sender = {
      name: warehouseInfo.name || "***",
      phone: warehouseInfo.phone || " ",
      address: warehouseInfo.address || "",
    };
    const receiver = {
      name: servicePartner.RECEIVER_FULLNAME || "***",
      phone: servicePartner.RECEIVER_PHONE || "***",
      address: shippingAddress.full_address || "***",
    };
    const parcel = {
      length: servicePartner.PRODUCT_LENGTH || "***",
      width: servicePartner.PRODUCT_WIDTH || "***",
      height: servicePartner.PRODUCT_HEIGHT || "***",
      weight: servicePartner.PRODUCT_WEIGHT
        ? servicePartner.PRODUCT_WEIGHT / 1000
        : "***",
    };
    const sortCode = partner.sort_code || "***";
    const orderGHN = partner.order_id_ghn || "***";
    const codAmount = servicePartner.MONEY_COLLECTION || "***";
    const allowMutualCheck = true;
    const allowTryOn = false;

    // Format dimensions and weight
    const dimensions =
      parcel.length !== "***"
        ? `${parcel.length}x${parcel.width}x${parcel.height}cm`
        : "***";
    const weight = parcel.weight !== "***" ? `${parcel.weight}kg` : "***";

    const pdfPath = path.join(PDF_DIR, `AWB_${shopId}_${orderId}.pdf`);

    // Initialize PDF document
    doc = new PDFDocument({
      size: [mmToPoints(PDF_SIZE[0]), mmToPoints(PDF_SIZE[1])],
      margin: 0,
    });

    writeStream = fs.createWriteStream(pdfPath);
    doc.pipe(writeStream);

    // Add logo dynamically
    addLogoToPdf(doc, logoPath, 5, 5, 32);

    // 🏷 Sender Info
    doc
      .font(FONTS.bold)
      .fontSize(9)
      .text(sender.name, mmToPoints(3), mmToPoints(25));

    doc
      .font(FONTS.regular)
      .text(`DC-618831-F124`, mmToPoints(3), mmToPoints(30), {
        width: mmToPoints(95),
        lineBreak: false,
      });

    // 📦 Receiver Info
    doc
      .font(FONTS.bold)
      .text(receiver.name.substring(0, 20), mmToPoints(3), mmToPoints(40));

    doc
      .font(FONTS.regular)
      .text(receiver.address, mmToPoints(3), mmToPoints(45), {
        width: mmToPoints(80),
      });

    // Generate and add barcode
    try {
      const barcodeBuffer = await bwipjs.toBuffer({
        bcid: "code128",
        text: trackingCode,
        scale: 3,
        height: 30,
        includetext: true,
      });
      doc.image(barcodeBuffer, mmToPoints(40), mmToPoints(5), {
        width: mmToPoints(55),
        height: mmToPoints(18),
      });
    } catch (barcodeError) {
      console.error("Barcode generation failed:", barcodeError);
      doc
        .font(FONTS.bold)
        .fontSize(12)
        .text(trackingCode, mmToPoints(40), mmToPoints(10), {
          width: mmToPoints(55),
          align: "center",
        });
    }

    // Generate and add QR code
    try {
      const qrBuffer = await QRCode.toBuffer(trackingCode, {
        width: mmToPoints(30),
        margin: 1,
      });
      doc.image(qrBuffer, mmToPoints(70), mmToPoints(64), {
        width: mmToPoints(25),
      });
    } catch (qrError) {
      console.error("QR code generation failed:", qrError);
    }

    // Add parcel info
    doc
      .font(FONTS.bold)
      .text(
        `Kích thước: ${dimensions} - ${weight}`,
        mmToPoints(3),
        mmToPoints(66),
        {
          width: mmToPoints(80),
        }
      );

    // Add items list
    itemsSKUandQuantity.forEach((item, index) => {
      doc
        .font(FONTS.regular)
        .fontSize(8)
        .text(
          `${index + 1}. ${item.sku} x ${item.quantity}`,
          mmToPoints(4),
          mmToPoints(75 + index * 3.5),
          { width: mmToPoints(80) }
        );
    });

    // Add separator line
    doc
      .lineWidth(0.5)
      .moveTo(mmToPoints(67), mmToPoints(65))
      .lineTo(mmToPoints(67), mmToPoints(98))
      .stroke();

    // Add borders and lines
    doc
      .lineWidth(0.5)
      .moveTo(mmToPoints(2), mmToPoints(25))
      .lineTo(mmToPoints(97), mmToPoints(25))
      .stroke();

    doc
      .rect(mmToPoints(2), mmToPoints(55), mmToPoints(95), mmToPoints(10))
      .stroke();

    // Add order information and sort code
    doc
      .font(FONTS.bold)
      .fontSize(14)
      .text(
        sortCode !== "***" ? `${sortCode}` : orderId,
        mmToPoints(5),
        mmToPoints(56),
        {
          width: mmToPoints(90),
          align: "center",
        }
      );

    doc
      .font(FONTS.bold)
      .fontSize(11)
      .text(orderGHN, mmToPoints(67), mmToPoints(86), {
        width: mmToPoints(30),
        align: "center",
      });

    // Main border
    doc
      .lineWidth(1.5)
      .rect(mmToPoints(2), mmToPoints(2), mmToPoints(95), mmToPoints(145))
      .stroke();

    // Additional lines
    doc
      .lineWidth(0.5)
      .moveTo(mmToPoints(2), mmToPoints(98))
      .lineTo(mmToPoints(97), mmToPoints(98))
      .stroke();

    doc
      .moveTo(mmToPoints(2), mmToPoints(111))
      .lineTo(mmToPoints(97), mmToPoints(111))
      .stroke();

    // Or using checkmark/cross symbols for better visual:
    doc
      .font(FONTS.bold)
      .fontSize(9)
      .text(allowMutualCheck ? "[✓]" : "[✗]", mmToPoints(3), mmToPoints(100));

    doc
      .font(FONTS.bold)
      .fontSize(9)
      .text(allowTryOn ? "[✓]" : "[✗]", mmToPoints(3), mmToPoints(104));

    // Add extra text or order ID
    doc
      .font(FONTS.bold)
      .fontSize(16)
      .text(extra || orderId, mmToPoints(10), mmToPoints(100), {
        width: mmToPoints(80),
        align: "right",
      });

    // Footer
    doc
      .font(FONTS.regular)
      .fontSize(8)
      .text(
        `Đóng gói bởi SwiftHub [${orderId}][${trackingCode}]`,
        mmToPoints(3),
        mmToPoints(141),
        {
          width: mmToPoints(90),
          align: "center",
        }
      );

    doc.end();

    return new Promise((resolve, reject) => {
      writeStream.on("finish", () => resolve(pdfPath));
      writeStream.on("error", reject);
    });
  } catch (error) {
    // Clean up resources if error occurs
    if (doc) doc.end();
    if (writeStream) writeStream.end();
    throw new Error(`Error generating AWB: ${error.message}`);
  }
};

// Helper function to add logo
const addLogoToPdf = (doc, logoPath, x, y, width) => {
  try {
    if (fs.existsSync(logoPath)) {
      doc.image(logoPath, mmToPoints(x), mmToPoints(y), {
        width: mmToPoints(width),
      });
    } else {
      console.warn(`Logo file not found at ${logoPath}`);
    }
  } catch (error) {
    console.error("Error adding logo:", error);
  }
};

// POST endpoint
app.post("/generate-awb", async (req, res) => {
  try {
    const { orderId: combinedOrderId, extra, token } = req.body;

    if (!combinedOrderId) {
      return res.status(400).json({ error: "orderId is required" });
    }

    const { shopId, orderId } = parseOrderId(combinedOrderId);
    const apiKey = token || DEFAULT_API_KEY;

    const pdfPath = await generateAWBPDF(shopId, orderId, apiKey, extra);
    const pdfUrl = `/awb/${shopId}_${orderId}.pdf`;

    res.json({
      success: true,
      message: "AWB PDF generated successfully",
      pdfUrl,
      downloadUrl: `${req.protocol}://${req.get("host")}${pdfUrl}`,
    });
  } catch (error) {
    console.error("POST Error:", error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      details: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  }
});

// GET endpoint
app.get("/3pl/get-awb/pancake/", async (req, res) => {
  try {
    const {
      orderId: combinedOrderId,
      token,
      shopId: providedShopId,
    } = req.query;

    if (!combinedOrderId || !token || !providedShopId) {
      return res.status(400).json({
        error:
          "Missing required parameters: orderId, token, and shopId are required",
      });
    }

    const { shopId, orderId } = parseOrderId(combinedOrderId);

    if (shopId !== providedShopId) {
      return res.status(400).json({
        error: "shopId parameter does not match the shopId in orderId",
      });
    }

    const pdfPath = await generateAWBPDF(shopId, orderId, token);
    const fileName = `AWB_${shopId}_${orderId}.pdf`;

    res.download(pdfPath, fileName, (err) => {
      if (err) {
        console.error("Download error:", err);
        if (!res.headersSent) {
          res.status(500).json({ error: "Failed to send PDF file" });
        }
      }

      // Clean up file after sending
      fs.unlink(pdfPath, (unlinkErr) => {
        if (unlinkErr) console.error("Error deleting temp PDF:", unlinkErr);
      });
    });
  } catch (error) {
    console.error("GET Error:", error.message);
    res.status(500).json({
      error: error.message,
      details: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  }
});

// Serve PDF files
app.use("/awb", express.static(PDF_DIR));

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({
    error: "Internal server error",
    details: process.env.NODE_ENV === "development" ? err.stack : undefined,
  });
});

// Start server
const PORT = process.env.PORT || 3008;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`PDF directory: ${path.resolve(PDF_DIR)}`);
});

