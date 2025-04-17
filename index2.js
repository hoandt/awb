const express = require("express");
const PDFDocument = require("pdfkit");
const bwipjs = require("bwip-js");
const QRCode = require("qrcode");
const fs = require("fs");
const cors = require("cors");
const axios = require("axios"); // Use axios to fetch partner data

const app = express();
app.use(cors());
app.use(express.json());

const pdfDir = "awb_pdfs";
if (!fs.existsSync(pdfDir)) fs.mkdirSync(pdfDir);

const mmToPoints = (mm) => mm * 2.83; // Convert mm to PDF points

// Function to fetch partner data from an external source (e.g., an API)
const getPartnerData = async (orderId) => {
  try {
    const response = await axios.get(
      // `https://pos.pages.fm/api/v1/shops/430107661/orders/${orderId}?api_key=0dd53f1ddc0245d8b3dd9ac1f69eee89` // PLAUModify URL as needed
      `https://pos.pages.fm/api/v1/shops/1390157215/orders/${orderId}?api_key=f749a78cbc46404da2d30e09fcb4a77c` // Modify URL as needed
      // `https://pos.pages.fm/api/v1/shops/1890158003/orders/${orderId}?api_key=983bc23c1a944cb5a396025903cf96e5` // Modify URL as needed
    );
    return response.data; // Assuming the response contains the order and partner info
  } catch (error) {
    throw new Error(`Failed to fetch partner data: ${error.message}`);
  }
};

app.post("/generate-awb", async (req, res) => {
  try {
    const { orderId, extra } = req.body; // Extract orderId from the request body

    // Fetch partner data
    const data = await getPartnerData(orderId);

    const partner = data.data.partner; // Extract 'partner' data
    const items = data.data.items;

    const itemsSKUandQuantity = items.map((item) => {
      return {
        sku: item.variation_info.display_id,
        quantity: item.quantity,
      };
    });
    const trackingCode = partner.extend_code;
    const sender = partner.service_partner.orders[0].sender_info;
    const receiver = partner.service_partner.orders[0].deliver_info;
    const parcel = partner.service_partner.orders[0].parcel_info;
    const sortCode = partner.sort_code;
    const orderGHN = partner.order_id_ghn;
    const codAmount =
      partner.service_partner.orders[0].fulfillment_info.cod_amount;

    const allow_mutual_check =
      partner.service_partner.orders[0].fulfillment_info.allow_mutual_check;
    const allow_try_on =
      partner.service_partner.orders[0].fulfillment_info.allow_try_on;
    const dim = `${parcel.parcel_length}x${parcel.parcel_width}x${parcel.parcel_height}cm`;
    const weight = `${parcel.parcel_weight}kg`;

    const pdfPath = `${pdfDir}/AWB_${orderId}.pdf`;

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
      .fontSize(10)
      .text(
        `${sender.sender_name} (${sender.sender_phone})`,
        mmToPoints(3),
        mmToPoints(25)
      );
    doc
      .font("./sans-reg.otf")
      .fontSize(9)
      .text(
        `${sender.sender_district}, ${sender.sender_city}`,
        mmToPoints(3),
        mmToPoints(30),
        {
          width: mmToPoints(95),
        }
      );
    // 🏷 Generate Barcode
    const barcodeBuffer = await bwipjs.toBuffer({
      bcid: "code128",
      text: trackingCode,
      scale: 3,
      height: 30,
      includetext: true,
    });
    // 📱 Generate QR Code
    const qrBuffer = await QRCode.toBuffer(trackingCode, {
      width: mmToPoints(30),
    });

    // Add Barcode (50 mm wide)
    doc.image(barcodeBuffer, mmToPoints(40), mmToPoints(5), {
      width: mmToPoints(55),
      height: mmToPoints(18),
    });

    //add dim and weight, cod amount nextto qr code, max width 80

    doc
      .font("./sans-bld.otf")
      .fontSize(9)
      .text(`Kích thước: ${dim} - ${weight}`, mmToPoints(3), mmToPoints(66), {
        width: mmToPoints(80), // Set max width to 20mm
      });

    //add item lines below the cod amount
    itemsSKUandQuantity.forEach((item, index) => {
      doc
        .font("./sans-reg.otf")
        .fontSize(8)
        .text(
          `${index + 1} ${item.sku} x ${item.quantity}`,
          mmToPoints(4),
          mmToPoints(75 + index * 3.5),
          {
            width: mmToPoints(80), // Set max width to 20mm
          }
        );
    });

    // Add QR Code (30 mm)
    doc.image(qrBuffer, mmToPoints(70), mmToPoints(64), {
      width: mmToPoints(25),
    });
    //add separator vertical line between skuwith quantity and qr code
    doc
      .lineWidth(0.5)
      .moveTo(mmToPoints(67), mmToPoints(65))
      .lineTo(mmToPoints(67), mmToPoints(98))
      .stroke();

    addLogoToPdf(doc, "./spx.png", 5, 5, 32);
    //add a line below logo
    doc
      .lineWidth(0.5)
      .moveTo(mmToPoints(2), mmToPoints(25))
      .lineTo(mmToPoints(97), mmToPoints(25))
      .stroke();

    // 📦 Receiver Info
    doc
      .fontSize(10)
      .font("./sans-bld.otf")
      .text(
        `${receiver.deliver_name.substring(0, 20)} (${receiver.deliver_phone})`,
        mmToPoints(3),
        mmToPoints(35)
      );
    doc
      .font("./sans-reg.otf")
      .fontSize(9)
      .text(receiver.deliver_detail_address, mmToPoints(3), mmToPoints(39.5), {
        width: mmToPoints(80),
      });
    doc.text(receiver.deliver_city, mmToPoints(3), mmToPoints(43));
    doc.text(receiver.deliver_state, mmToPoints(3), mmToPoints(47));
    //add a black filled rectangle below the cod
    doc
      .rect(mmToPoints(2), mmToPoints(55), mmToPoints(95), mmToPoints(10))
      .stroke();
    // note
    doc
      .font("./sans-bld.otf")

      .fontSize(14)
      .text(`NGOẠI SÀN  ${sortCode}`, mmToPoints(5), mmToPoints(56), {
        width: mmToPoints(90), // Set max width to 20mm
        align: "center", // Align text (optional)
      });

    // orderGHN, max width 20
    doc
      .font("./sans-bld.otf")
      .fontSize(11)
      .text(`${orderGHN}`, mmToPoints(67), mmToPoints(86), {
        width: mmToPoints(30), // Set max width to 20mm
        align: "center", // Align text (optional)
      });

    //add a bold black border around the page, offset by 3mm
    doc
      .lineWidth(1.5)
      .rect(mmToPoints(2), mmToPoints(2), mmToPoints(95), mmToPoints(145))
      .stroke();

    //add a line below the sort code
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
    //add note allow_mutual_check, allow_try_on, cod_collection
    const allow = "";
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
      .text(`${extra ? extra : $orderId}`, mmToPoints(10), mmToPoints(100), {
        width: mmToPoints(80), // Set max width to 20mm
        align: "right", // Align text (optional)
      });

    //add checkbox before each note
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
        `${allow_try_on ? "[OK]" : "[NO]"}`,
        mmToPoints(3),
        mmToPoints(104)
      );

    //add text fulfill by SwiftHub and logo at the bottom
    doc
      .font("./sans-reg.otf")
      .fontSize(8)
      .text(
        `Đóng gói bởi SwiftHub [${orderId}][${trackingCode}]`,
        mmToPoints(3),
        mmToPoints(141),
        {
          width: mmToPoints(90), // Set max width to 20mm
          align: "center", // Align text (optional)
        }
      );

    //add logo
    addLogoToPdf(doc, "./logo.png", 5, 112, 20);

    //add text "vui lòng quay video khi mở hàng" next to logo and border it
    doc
      .font("./sans-reg.otf")
      .fontSize(12)
      .text(
        `VUI LÒNG QUAY VIDEO KHI MỞ HÀNG`,
        mmToPoints(30),
        mmToPoints(116),
        {
          width: mmToPoints(65), // Set max width to 20mm
          align: "center", // Align text (optional)
        }
      );

    //scale the logo to 35mm width

    //add a barcode SFC-WH1-ORD123 vertically at the bottom right corner
    const barcodeBuffer2 = await bwipjs.toBuffer({
      bcid: "code128",
      text: `SFC-WH1-${orderId}`,
      scale: 2,
      height: 6,
      includetext: true,
      //rotate 90 degree
      // rotate: "R",
    });
    doc.image(barcodeBuffer2, mmToPoints(6), mmToPoints(132), {
      width: mmToPoints(88),
      height: mmToPoints(8),
    });

    doc.end();

    writeStream.on("finish", () => {
      res.json({ message: "AWB PDF generated", pdfUrl: `/awb/${orderId}.pdf` });
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.use("/awb", express.static(pdfDir));

app.listen(3000, () => console.log("Server running on http://localhost:3000"));

// Function to add a PNG logo to the PDF
const addLogoToPdf = (doc, logoPath, x, y, width) => {
  // Add the PNG logo to the PDF at a specified position
  doc.image(logoPath, mmToPoints(x), mmToPoints(y), {
    width: mmToPoints(width),
  });
  //scale the logo to 35mm width
};
