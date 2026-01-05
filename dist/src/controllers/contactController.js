"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendContactEmail = void 0;
const nodemailer_1 = __importDefault(require("nodemailer"));
const errorHandler_1 = require("../utils/errorHandler");
const sendContactEmail = async (req, res) => {
    try {
        const { name, email, message } = req.body;
        if (!name || !email || !message) {
            res.status(400).json({ message: "All fields are required" });
            return;
        }
        // Check if email credentials are provided
        if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
            console.warn("EMAIL_USER or EMAIL_PASS not set. Skipping email sending (Mock Mode).");
            console.log(`[Mock Email] From: ${name} <${email}>\nMessage: ${message}`);
            res.status(200).json({ message: "Email sent successfully (Mock Mode)" });
            return;
        }
        const user = process.env.EMAIL_USER.trim();
        const pass = process.env.EMAIL_PASS.trim();
        const to = (process.env.EMAIL_TO || user).trim();
        console.log(`Attempting to send email from ${user} to ${to}...`);
        // Create transporter
        const transporter = nodemailer_1.default.createTransport({
            service: "gmail",
            auth: {
                user: user,
                pass: pass,
            },
        });
        // Email options
        const mailOptions = {
            from: user,
            to: to, // Send to self if EMAIL_TO is not set
            replyTo: email,
            subject: `New Contact Form Submission from ${name}`,
            text: `
        Name: ${name}
        Email: ${email}
        
        Message:
        ${message}
      `,
            html: `
        <h3>New Contact Form Submission</h3>
        <p><strong>Name:</strong> ${name}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Message:</strong></p>
        <p>${message.replace(/\n/g, "<br>")}</p>
      `,
        };
        // Send email
        await transporter.sendMail(mailOptions);
        res.status(200).json({ message: "Email sent successfully" });
    }
    catch (err) {
        res.status(500).json((0, errorHandler_1.createErrorResponse)(err, "Failed to send email"));
    }
};
exports.sendContactEmail = sendContactEmail;
