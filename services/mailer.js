const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_PASS
    }
});

function send(subject, text) {
    const mailOptions = {
        from: process.env.GMAIL_USER,
        to: process.env.ALERT_EMAIL,
        subject,
        text
    };
    transporter.sendMail(mailOptions, (err) => {
        if (err) console.log("Mail error:", err.message);
    });
}

module.exports = { send };