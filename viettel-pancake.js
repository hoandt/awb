const express = require("express");
const PDFDocument = require("pdfkit");
const bwipjs = require("bwip-js");
const QRCode = require("qrcode");
const fs = require("fs");
const cors = require("cors");
const axios = require("axios");

const app = express();
app.use(cors());
app.use(express.json());

const pdfDir = "awb_pdfs";
if (!fs.existsSync(pdfDir)) fs.mkdirSync(pdfDir);

const mmToPoints = (mm) => mm * 2.83; // Convert mm to PDF points

// Function to validate and parse combined orderId (e.g., "1390157215_34773")
const parseOrderId = (combinedOrderId) => {
  if (!combinedOrderId || typeof combinedOrderId !== "string") {
    throw new Error("Invalid or missing orderId");
  }
  const [shopId, orderId] = combinedOrderId.split("_");
  if (!shopId || !orderId) {
    throw new Error("orderId must be in the format shopId_orderId");
  }
  return { shopId, orderId };
};

// Function to fetch partner data from an external source
const getPartnerData = async (shopId, orderId, apiKey) => {
  try {
    const response = await axios.get(
      `https://pos.pages.fm/api/v1/shops/${shopId}/orders/${orderId}?api_key=${apiKey}`
    );
    return response.data;
  } catch (error) {
    console.error(`Failed to fetch partner data: ${error.message}`);
    throw new Error(`Failed to fetch partner data: ${error.message}`);
  }
};

// Reusable function to generate PDF
const generateAWBPDF = async (shopId, orderId, apiKey, extra = "") => {
  try {
    // Fetch partner data
    const data = await getPartnerData(shopId, orderId, apiKey);

    // Safely extract data with "NA" as default
    const partner = data.data?.partner || {};
    const items = data.data?.items || [];
    const servicePartner = partner.service_partner || {};
    const warehouseInfo = data.data?.warehouse_info || {};
    const shippingAddress = data.data?.shipping_address || {};

    // Map items to SKU and quantity
    const itemsSKUandQuantity = items.map((item) => ({
      sku: item?.variation_info?.display_id || "NA",
      quantity: item?.quantity || "NA",
    }));

    // Extract fields with defaults
    const trackingCode = partner.order_number_vtp || "NA";
    const sender = {
      sender_name: warehouseInfo.name || "NA",
      sender_phone: " " || " ",
      sender_full_address: "",
    };
    const receiver = {
      deliver_name: servicePartner.RECEIVER_FULLNAME || "NA",
      deliver_phone: servicePartner.RECEIVER_PHONE || "NA",
      deliver_full_address: shippingAddress.full_address || "NA",
    };
    const parcel = {
      parcel_length: servicePartner.PRODUCT_LENGTH || "NA",
      parcel_width: servicePartner.PRODUCT_WIDTH || "NA",
      parcel_height: servicePartner.PRODUCT_HEIGHT || "NA",
      parcel_weight: servicePartner.PRODUCT_WEIGHT
        ? servicePartner.PRODUCT_WEIGHT / 1000
        : "NA", // Convert grams to kg
    };
    const sortCode = partner.sort_code || "NA";
    const orderGHN = partner.order_id_ghn || "NA";
    const codAmount = servicePartner.MONEY_COLLECTION || "NA";
    const allow_mutual_check = true; // Default
    const allow_try_on = false; // Default
    const dim =
      parcel.parcel_length !== "NA"
        ? `${parcel.parcel_length}x${parcel.parcel_width}x${parcel.parcel_height}cm`
        : "NA";
    const weight =
      parcel.parcel_weight !== "NA" ? `${parcel.parcel_weight}kg` : "NA";

    const pdfPath = `${pdfDir}/AWB_${shopId}_${orderId}.pdf`;

    const doc = new PDFDocument({
      size: [mmToPoints(100), mmToPoints(150)],
      margin: 0,
    });
    const writeStream = fs.createWriteStream(pdfPath);
    doc.pipe(writeStream);

    // 🏷 Sender Info
    doc
      .font("./sans-bld.otf")
      .fillColor("black")
      .fontSize(9)
      .text(`${sender.sender_name} `, mmToPoints(3), mmToPoints(25));
    doc
      .font("./sans-reg.otf")
      .fontSize(9)
      .text(
        `${sender.sender_full_address} ${sender.sender_phone}`,
        mmToPoints(3),
        mmToPoints(30),
        { width: mmToPoints(95) }
      );

    // 📦 Receiver Info
    doc
      .fontSize(9)
      .font("./sans-bld.otf")
      .text(
        `${receiver.deliver_name.substring(0, 20)}`,
        mmToPoints(3),
        mmToPoints(40)
      );
    doc
      .font("./sans-reg.otf")
      .fontSize(9)
      .text(receiver.deliver_full_address, mmToPoints(3), mmToPoints(45), {
        width: mmToPoints(80),
      });

    // 🏷 Generate Barcode
    const barcodeBuffer = await bwipjs.toBuffer({
      bcid: "code128",
      text: trackingCode !== "NA" ? trackingCode : "NO_TRACKING_CODE",
      scale: 3,
      height: 30,
      includetext: true,
    });

    // 📱 Generate QR Code
    const qrBuffer = await QRCode.toBuffer(
      trackingCode !== "NA" ? trackingCode : "NO_TRACKING_CODE",
      { width: mmToPoints(30) }
    );

    // Add Barcode
    doc.image(barcodeBuffer, mmToPoints(40), mmToPoints(5), {
      width: mmToPoints(55),
      height: mmToPoints(18),
    });

    // Add dim, weight, cod amount
    doc
      .font("./sans-bld.otf")
      .fontSize(9)
      .text(`Kích thước: ${dim} - ${weight}`, mmToPoints(3), mmToPoints(66), {
        width: mmToPoints(80),
      });

    // Add item lines
    itemsSKUandQuantity.forEach((item, index) => {
      doc
        .font("./sans-reg.otf")
        .fontSize(8)
        .text(
          `${index + 1} ${item.sku} x ${item.quantity}`,
          mmToPoints(4),
          mmToPoints(75 + index * 3.5),
          { width: mmToPoints(80) }
        );
    });

    // Add QR Code
    doc.image(qrBuffer, mmToPoints(70), mmToPoints(64), {
      width: mmToPoints(25),
    });

    // Add separator line
    doc
      .lineWidth(0.5)
      .moveTo(mmToPoints(67), mmToPoints(65))
      .lineTo(mmToPoints(67), mmToPoints(98))
      .stroke();

    addLogoToPdf(doc, "./vtp.png", 5, 5, 32);

    // Add lines and borders
    doc
      .lineWidth(0.5)
      .moveTo(mmToPoints(2), mmToPoints(25))
      .lineTo(mmToPoints(97), mmToPoints(25))
      .stroke();

    doc
      .rect(mmToPoints(2), mmToPoints(55), mmToPoints(95), mmToPoints(10))
      .stroke();

    // Note
    doc
      .font("./sans-bld.otf")
      .fontSize(14)
      .text(`${orderId}`, mmToPoints(5), mmToPoints(56), {
        width: mmToPoints(90),
        align: "center",
      });

    // orderGHN
    doc
      .font("./sans-bld.otf")
      .fontSize(11)
      .text(`${orderGHN}`, mmToPoints(67), mmToPoints(86), {
        width: mmToPoints(30),
        align: "center",
      });

    // Page border
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
      .lineWidth(0.5)
      .moveTo(mmToPoints(2), mmToPoints(111))
      .lineTo(mmToPoints(97), mmToPoints(111))
      .stroke();

    // Notes
    doc
      .font("./sans-reg.otf")
      .fontSize(9)
      .text(`Đồng kiểm`, mmToPoints(12), mmToPoints(100));
    doc
      .font("./sans-reg.otf")
      .fontSize(9)
      .text(`Cho thử`, mmToPoints(12), mmToPoints(104));

    doc
      .font("./sans-bld.otf")
      .fontSize(16)
      .text(`${extra || orderId}`, mmToPoints(10), mmToPoints(100), {
        width: mmToPoints(80),
        align: "right",
      });

    // Checkboxes
    doc
      .font("./sans-bld.otf")
      .fontSize(9)
      .text(
        `${allow_mutual_check ? "[OK]" : "[NO]"}`,
        mmToPoints(3),
        mmToPoints(100)
      );
    doc
      .font("./sans-bld.otf")
      .fontSize(9)
      .text(
        `${allow_try_on ? "[NO]"}`,
        mmToPoints(3),
        mmToPoints(104)
      );

    // Footer
    doc
      .font("./sans-reg.otf")
      .fontSize(8)
      .text(
        `Đóng gói bởi SwiftHub [${orderId}][${trackingCode}]`,
        mmToPoints(3),
        mmToPoints(141),
        { width: mmToPoints(90), align: "center" }
      );

    doc.end();

    return new Promise((resolve, reject) => {
      writeStream.on("finish", () => resolve(pdfPath));
      writeStream.on("error", (err) => reject(err));
    });
  } catch (error) {
    throw new Error(`Error generating AWB: ${error.message}`);
  }
};

// POST endpoint
app.post("/generate-awb", async (req, res) => {
  try {
    const { orderId: combinedOrderId, extra } = req.body;
    if (!combinedOrderId) {
      return res.status(400).json({ error: "orderId is required" });
    }

    // Parse combined orderId
    const { shopId, orderId } = parseOrderId(combinedOrderId);

    // For POST, use a default token or require it in the body
    const apiKey = req.body.token || "f749a78cbc46404da2d30e09fcb4a77c"; // Default or from body

    const pdfPath = await generateAWBPDF(shopId, orderId, apiKey, extra);
    res.json({ message: "AWB PDF generated", pdfUrl: `/awb/${shopId}_${orderId}.pdf` });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: error.message });
  }
});

// GET endpoint for AWB generation
app.get("/3pl/get-awb/pancake/", async (req, res) => {
  try {
    const { orderId: combinedOrderId, token, shopId: providedShopId } = req.query;

    // Validate inputs
    if (!combinedOrderId || !token || !providedShopId) {
      return res
        .status(400)
        .json({ error: "orderId, token, and shopId are required" });
    }

    // Parse combined orderId
    const { shopId, orderId } = parseOrderId(combinedOrderId);

    // Validate shopId consistency
    if (shopId !== providedShopId) {
      return res.status(400).json({ error: "shopId does not match orderId prefix" });
    }

    // Generate PDF using the provided token as api_key
    const pdfPath = await generateAWBPDF(shopId, orderId, token);

    // Send the PDF file directly
    res.download(pdfPath, `AWB_${shopId}_${orderId}.pdf`, (err) => {
      if (err) {
        console.error(`Error sending PDF: ${err.message}`);
        res.status(500).json({ error: "Error sending PDF" });
      }
    });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: error.message });
  }
});

// Serve PDF files
app.use("/awb", express.static(pdfDir));

// Function to add a PNG logo to the PDF
const addLogoToPdf = (doc, logoPath, x, y, width) => {
  doc.image(logoPath, mmToPoints(x), mmToPoints(y), {
    width: mmToPoints(width),
  });
};

app.listen(3000, () => console.log("Server running on http://localhost:3000"));