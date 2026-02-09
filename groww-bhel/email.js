const nodemailer = require('nodemailer');
const { EMAIL_TO, GMAIL_USER, GMAIL_PASS } = require("./config");


const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: GMAIL_USER,
        pass: GMAIL_PASS
    }
});
 

function sendEmail(subject, text) {
    const mailOptions = {
        from: GMAIL_USER,
        to: EMAIL_TO,
        subject,
        text
    };
    transporter.sendMail(mailOptions, (err) => {
        if (err) console.log("Mail error:", err.message);
    });
}

module.exports = { sendEmail };