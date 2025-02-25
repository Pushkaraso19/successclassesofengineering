import express from "express";
import pg from "pg";
import env from "dotenv";
import methodOverride from "method-override";
import nodemailer from "nodemailer";
import bcrypt from "bcrypt";
import session from "express-session";
import pgSession from "connect-pg-simple";
import passport from "passport";
import { Strategy } from "passport-local";
import crypto from "crypto";
import winston from "winston";
import cors from "cors"
import helmet from "helmet";
import compression from "compression";  

const app = express();
const PORT = process.env.PORT || 3000;
const saltRounds = 10;

env.config();

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'combined.log' })
    ]
});

const requiredEnvVars = [
    'DB_USER',
    'DB_HOST',
    'DB_DATABASE',
    'DB_PASSWORD',
    'DB_PORT',
    'SESSION_SECRET',
    'EMAIL_USER',
    'EMAIL_PASS',
    'RECEIVER_EMAIL',
    'APP_URL'
];

requiredEnvVars.forEach((varName) => {
    if (!process.env[varName]) {
        logger.error(`Error: Missing required environment variable: ${varName}`);
        process.exit(1); 
    }
});

const pool = new pg.Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_DATABASE,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
    ssl: { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 600000,
});

app.use(
    helmet({
        contentSecurityPolicy: false,
    })
);
app.use(
    cors({
        origin: process.env.ALLOWED_ORIGIN, 
        credentials: true, 
    })
);

app.use(
    compression({
        tfilter: (req, res) => {
            if (req.headers["x-no-compression"]) {
                return false;
            }
            return compression.filter(req, res);
        },
        threshold: 1024,
    })
);

app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));
app.use(express.static("public"));

const pgSessionStore = pgSession(session);
app.use(session({
    store: new pgSessionStore({
        pool: pool, 
        tableName: "session"
    }),
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false, 
    cookie: {
        secure: process.env.NODE_ENV === "production", 
        maxAge: 30 * 24 * 60 * 60 * 1000 
    }
}));

app.use(passport.initialize());
app.use(passport.session());
app.use((req, res, next) => {
    res.locals.user = req.user;
    next();
});

function ensureAuthenticated(req, res, next) {
    if (req.isAuthenticated()) {
        return next();
    }
    res.redirect('/login');
}

function redirectIfAuthenticated(req, res, next) {
    if (req.isAuthenticated()) {
        return res.redirect("/"); 
    }
    next();
}

async function getAcademicYears() {
    const result = await pool.query('SELECT * FROM academic_years ORDER BY id ASC');
    return result.rows;
}

async function getBatches() {
    const result = await pool.query('SELECT * FROM batches ORDER BY id ASC');
    return result.rows;
}

async function sendEmailWithStudentDetails() {
    const result = await pool.query(`
        SELECT s.name, s.contact, s.fees_paid, s.fees_pending, s.closing_amount, a.actual_amount, s.last_payment_date, s.next_installment_date
        FROM students s
        LEFT JOIN actual_amounts a ON s.actual_amount_id = a.id  
        WHERE s.next_installment_date = CURRENT_DATE + INTERVAL '8 days'
        ORDER BY s.id ASC;
    `);
        
    const today = new Date().toISOString().split('T')[0];
    const students = result.rows;

    let transporter = nodemailer.createTransport({
        host: "smtp.gmail.com",
        port: 465,
        secure: true,
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS
        }
    });

    if (students.length === 0) {
        let noDueMailOptions = {
            from: process.env.EMAIL_USER,
            to: process.env.RECEIVER_EMAIL,
            subject: `No Due Installments Today [${today}]`,
            html: `<h3>No students have an installment due in 8 days.</h3>`
        };

        try {
            await transporter.sendMail(noDueMailOptions);
            logger.info('No due email sent successfully.');
        } catch (error) {
            logger.error(`Error sending no-due notification:`, error.message);
        }
        return;
    }

    let emailContent = `
        <h2>Students with Upcoming Installments (Due in 8 Days) - ${today}</h2>
        <table border="1" cellpadding="5" cellspacing="0" style="border-collapse: collapse; width: 100%;">
            <thead>
                <tr style="background-color: #f2f2f2;">
                    <th>Name</th>
                    <th>Contact</th>
                    <th>Fees Paid</th>
                    <th>Fees Pending</th>
                    <th>Closing Amount</th>
                    <th>Actual Amount</th>
                    <th>Last Payment Date</th>
                    <th>Next Installment Date</th>
                </tr>
            </thead>
            <tbody>
    `;

    students.forEach(student => {
        emailContent += `
            <tr>
                <td>${student.name}</td>
                <td>${student.contact}</td>
                <td>${student.fees_paid}</td>
                <td>${student.fees_pending}</td>
                <td>${student.closing_amount}</td>
                <td>${student.actual_amount}</td>
                <td>${student.last_payment_date.toISOString().split('T')[0]}</td>
                <td>${student.next_installment_date.toISOString().split('T')[0]}</td>
            </tr>
        `;
    });

    emailContent += `
            </tbody>
        </table>
    `;

    let mailOptions = {
        from: process.env.EMAIL_USER,
        to: process.env.RECEIVER_EMAIL,
        subject: `Upcoming Installments (Due in 8 Days) - ${today}`,
        html: emailContent
    };

    try {
        const maxRetries = 3;
        let attempt = 0;
        let emailSent = false;

        while (attempt < maxRetries && !emailSent) {
            try {
                await transporter.sendMail(mailOptions);
                emailSent = true;
                logger.info('Email sent successfully.');
            } catch (error) {
                attempt++;
                logger.error(`Attempt ${attempt} - Error sending email:`, error.message);
                if (attempt >= maxRetries) {
                    logger.error('Max retries reached. Failed to send email.');
                }
            }
        }
    } catch (error) {
        logger.error(`Error sending email:`, error.message);
    }
}

app.get('/63726F6E4A6F6253656E64456D61696C', async () => {
    try {
        await sendEmailWithStudentDetails();
    } catch (error) {
        logger.error('Error sending email with student details:', error.message);
    }
});

app.get('/', ensureAuthenticated, async (req, res, next) => { 
    try {
        const academicYearsResult = await getAcademicYears();
        const batchesResult = await getBatches();
        const studentsResult = await pool.query(
            `SELECT s.*, ay.year, b.batch_name, a.actual_amount 
             FROM students s 
             JOIN academic_years ay ON s.academic_year_id = ay.id 
             LEFT JOIN batches b ON s.batch_id = b.id 
             LEFT JOIN actual_amounts a ON s.actual_amount_id = a.id
             ORDER BY s.id ASC;`
        );

        res.render('index.ejs', {
            pageTitle: 'Home', 
            academicYears: academicYearsResult,
            batches: batchesResult,
            students: studentsResult.rows,
            academicYearSelected: null,
            batchSelected: null,
            callTypeSelected: null
        });
    } catch (error) {
        logger.error('Error fetching data for home page:', error.message);
        error.status = 500;
        error.title = "Error fetching data for home page";
        return next(error); 
    }
});


app.get("/login", redirectIfAuthenticated, async (req, res) => {
    try {
        const result = await pool.query("SELECT allow_registration FROM config WHERE id = 1");
        const allowRegistration = result.rows[0]?.allow_registration || false;

        res.render("login.ejs", {
            pageTitle: 'Login', 
            allowRegistration 
        });
    } catch (error) {
        logger.error("Error fetching registration setting: ", error);
        error.status = 500;
        error.title = "Error fetching registration setting";
        return next(error); 
    }
});

app.get("/register", redirectIfAuthenticated, async (req, res) => {
    try {
        const result = await pool.query("SELECT allow_registration FROM config WHERE id = 1");
        const isRegistrationAllowed = result.rows[0]?.allow_registration;

        if (!isRegistrationAllowed) {
            return res.redirect("/login?error=" + encodeURIComponent("Registration is currently disabled."));
        }

        res.render("register.ejs", { pageTitle: 'Register' });
    } catch (error) {
        logger.error("Error checking registration status: ", error);
        error.status = 500;
        error.title = "Error checking registration status";
        return next(error); 
    }
});

app.post("/login", (req, res, next) => {
    passport.authenticate("local", (err, user, info) => {
        if (err) {
            logger.error("Login error:", err.message || "An error occurred");
            return res.redirect("/login?error=" + encodeURIComponent(err.message || "An error occurred"));
        }
        if (!user) {
            logger.warn("Invalid login attempt for username:", req.body.username);
            return res.redirect("/login?error=" + encodeURIComponent("Invalid username or password"));
        }
        req.logIn(user, (err) => {
            if (err) {
                logger.error("Login error:", err.message || "An error occurred");
                return res.redirect("/login?error=" + encodeURIComponent(err.message || "An error occurred"));
            }
            return res.redirect("/?success=" + encodeURIComponent("Login successful!"));
        });
    })(req, res, next);
});

app.post("/register", async (req, res) => {
    try {
        const result = await pool.query("SELECT allow_registration FROM config WHERE id = 1");
        const isRegistrationAllowed = result.rows[0]?.allow_registration;

        if (!isRegistrationAllowed) {
            return res.redirect("/login?error=" + encodeURIComponent("Registration is currently disabled."));
        }

        const { username, password, email } = req.body;
        const checkResult = await pool.query("SELECT * FROM users WHERE username = $1", [username]);
        
        if (checkResult.rows.length > 0) {
            logger.warn("Registration attempt with existing username:", username);
            return res.redirect("/login?error=" + encodeURIComponent("User  already exists. Try logging in."));
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        await pool.query("INSERT INTO users (username, password, email) VALUES ($1, $2, $3)", [username, hashedPassword, email]);

        res.redirect("/login?success=" + encodeURIComponent("Registration successful! Please log in."));
    } catch (error) {
        logger.error("Error during registration: ", error);
        error.status = 500;
        error.title = "Error during registration";
        return next(error); 
    }
});

app.get("/forgot-password", redirectIfAuthenticated, (req, res) => {
    res.render("forgotpassword.ejs", {
        pageTitle: 'Forgot Password', 
        error: req.query.error, 
        success: req.query.success 
    });
});

app.post("/forgot-password", async (req, res) => {
    const { username } = req.body;
    
    try {
        const userResult = await pool.query("SELECT * FROM users WHERE username = $1", [username]);

        if (userResult.rows.length === 0) {
            logger.warn("Password reset attempt for non-existing user:", username);
            return res.redirect("/forgot-password?error=" + encodeURIComponent("No account found with this username."));
        }

        const user = userResult.rows[0];
        const resetToken = crypto.randomBytes(32).toString("hex");
        const resetTokenExpiry = new Date(Date.now() + 3600000);

        const hashedToken = await bcrypt.hash(resetToken, saltRounds);

        let transporter = nodemailer.createTransport({
            host: "smtp.gmail.com",
            port: 465,
            secure: true,
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS,
            },
        });

        const resetLink = `${process.env.APP_URL}/reset-password?token=${resetToken}`;

        let mailOptions = {
            from: process.env.EMAIL_USER,
            to: process.env.RECEIVER_EMAIL,
            subject: "Password Reset Request",
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; background-color: #f8f9fa; border-radius: 10px; text-align: center; border: 1px solid #ddd;">
                    <h2 style="color: #333;">Password Reset Request</h2>
                    <p style="color: #555; font-size: 16px;">
                        Hello <strong>${user.username}</strong>,<br>
                        You requested a password reset. Click the button below to reset your password:
                    </p>
                    <a href="${resetLink}" style="display: inline-block; padding: 12px 20px; font-size: 16px; color: #fff; background-color: #20C997; text-decoration: none; border-radius: 5px; margin-top: 10px;">
                        Reset Password
                    </a>
                    <p style="color: #555; font-size: 14px; margin-top: 20px;">
                        This link will expire in <strong>1 hour</strong>.
                    </p>
                </div>
            `,
        };

        await transporter.sendMail(mailOptions);

        await pool.query(
            "UPDATE users SET reset_token = $1, reset_token_expiry = $2 WHERE username = $3",
            [hashedToken, resetTokenExpiry, username]
        );

        logger.info("Password reset link sent to email for user:", username);
        res.redirect("/forgot-password?success=" + encodeURIComponent("Password reset link has been sent to your email."));
    } catch (error) {
        logger.error("Error in forgot password:", error);
        res.redirect("/forgot-password?error=" + encodeURIComponent("An error occurred. Please try again."));
    }
});

app.get("/reset-password", async (req, res) => {
    const { token } = req.query;

    try {
        const result = await pool.query(
            "SELECT id, reset_token FROM users WHERE reset_token_expiry > NOW()"
        );

        if (result.rows.length === 0) {
            logger.warn("Invalid or expired reset link attempt.");
            return res.redirect("/forgot-password?error=" + encodeURIComponent("Invalid or expired reset link."));
        }

        const user = result.rows[0];
        const isTokenValid = await bcrypt.compare(token, user.reset_token);
        if (!isTokenValid) {
            logger.warn("Invalid or expired reset link attempt for user ID:", user.id);
            return res.redirect("/forgot-password?error=" + encodeURIComponent("Invalid or expired reset link."));
        }
        res.render("resetpassword.ejs", { 
            pageTitle: 'Reset Password',
            token, 
            error: req.query.error 
        });

    } catch (error) {
        logger.error("Error in reset password page:", error);
        res.redirect("/forgot-password?error=" + encodeURIComponent("An error occurred. Please try again."));
    }
});

app.post("/reset-password", async (req, res) => {
    const { token, password, confirmPassword } = req.body;

    try {
        if (password !== confirmPassword) {
            logger.warn("Password reset attempt with mismatched passwords.");
            return res.redirect(`/reset-password?token=${token}&error=` + encodeURIComponent("Passwords do not match."));
        }

        const result = await pool.query(
            "SELECT id, reset_token FROM users WHERE reset_token_expiry > NOW()"
        );

        if (result.rows.length === 0) {
            logger.warn("Invalid or expired reset link attempt.");
            return res.redirect("/forgot-password?error=" + encodeURIComponent("Invalid or expired reset link."));
        }

        const user = result.rows[0];

        const isTokenValid = await bcrypt.compare(token, user.reset_token);
        if (!isTokenValid) {
            logger.warn("Invalid or expired reset link attempt for user ID:", user.id);
            return res.redirect("/forgot-password?error=" + encodeURIComponent("Invalid or expired reset link."));
        }

        const hashedPassword = await bcrypt.hash(password, saltRounds);
        await pool.query(
            "UPDATE users SET password = $1, reset_token = NULL, reset_token_expiry = NULL WHERE id = $2",
            [hashedPassword, user.id]
        );
        res.redirect("/login?success=" + encodeURIComponent("Password has been reset successfully. Please login with your new password."));
    } catch (error) {
        logger.error('Error in reset password:', error);
        res.redirect(`/reset-password?token=${token}&error=` + encodeURIComponent("An error occurred. Please try again."));
    }
});

app.get("/logout", (req, res, next) => {
    req.session.destroy((err) => {
        if (err) {
            logger.error("Error destroying session:", err);
            return res.redirect("/?error=" + encodeURIComponent("Could not log out"));
        }

        res.clearCookie("connect.sid", { path: "/" });

        res.redirect("/login?success=" + encodeURIComponent("Logged out successfully"));
    });
});

app.get('/filter-students', ensureAuthenticated, async (req, res) => {
    try {
        const { academic_year, batch, call_type } = req.query;

        let query = `
            SELECT s.*, ay.year, b.batch_name, a.actual_amount
            FROM students s
            JOIN academic_years ay ON s.academic_year_id = ay.id
            LEFT JOIN batches b ON s.batch_id = b.id
            LEFT JOIN actual_amounts a ON s.actual_amount_id = a.id 
            WHERE s.academic_year_id = $1
        `;
        let params = [academic_year];

        if (batch && batch !== '') {
            query += ' AND s.batch_id = $2';
            params.push(batch);
        }

        const studentsResult = await pool.query(query, params);
        const academicYearsResult = await getAcademicYears();
        const batchesResult = await getBatches();
        res.render('index.ejs', {
            pageTitle: 'Home',
            academicYears: academicYearsResult,
            batches: batchesResult,
            students: studentsResult.rows,
            academicYearSelected: academic_year,
            batchSelected: batch,
            callTypeSelected: call_type
        });
    } catch (error) {
        logger.error('Error filtering students:', error.message);
        res.status(500).send('Error filtering students: ' + error.message);
        res.redirect(`/error=${encodeURIComponent("Error Filtering Students")}`);
    }
});

app.get('/students/add', ensureAuthenticated, async (req, res) => {
    try {
        const academicYearsResult = await getAcademicYears();
        const batchesResult = await getBatches();

        res.render('addStudent.ejs', {
            pageTitle: 'Add Student',
            academicYears: academicYearsResult,
            batches: batchesResult
        });
    } catch (error) {
        logger.error('Error rendering add student page: ', error.message);
        error.status = 500;
        error.title = "Error rendering add student page";
        return next(error); 
    }
});

app.get('/get-actualamount', ensureAuthenticated, async (req, res) => {
    try {
        const { academic_year_id, batch_id } = req.query;
        let query = '';
        let params = [];
        if (batch_id) {
            query = 'SELECT actual_amount FROM actual_amounts WHERE academic_year_id = $1 AND batch_id = $2';
            params = [academic_year_id, batch_id];
        } else {
            query = 'SELECT actual_amount FROM actual_amounts WHERE academic_year_id = $1 AND batch_id IS NULL';
            params = [academic_year_id];
        }

        const result = await pool.query(query, params);
        if (result.rows.length > 0) {
            res.json({ actual_amount: result.rows[0].actual_amount });
        } else {
            res.json({ actual_amount: 0 });
        }
    } catch (error) {
        logger.error('Error fetching actual amount: ', error.message);
        res.redirect(`/error=${encodeURIComponent("Error fetching actual amount")}`);
    }
});

app.post('/student/add', ensureAuthenticated, async (req, res) => {
    try {
        const { name, contact, academic_year_id, batch_id, fees_paid, fees_pending, closing_amount, last_payment_date, next_installment_date } = req.body;

        if(fees_pending != 0 && next_installment_date == "") {
            logger.warn("Attempt to add student without next installment date.");
            return res.redirect(`/students/add?error=${encodeURIComponent('Enter next installment date')}`);
        }
        const actualAmountResult = await pool.query(`
            SELECT id FROM actual_amounts 
            WHERE academic_year_id = $1 AND (batch_id = $2 OR batch_id IS NULL)
            ORDER BY batch_id DESC 
            LIMIT 1
        `, [academic_year_id, batch_id]);

        const actual_amount_id = actualAmountResult.rows[0].id;
        const query = `
            INSERT INTO students (name, contact, academic_year_id, batch_id, fees_paid, fees_pending, closing_amount, actual_amount_id, last_payment_date, next_installment_date)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING id
        `;

        const values = [name, contact, academic_year_id, batch_id, fees_paid, fees_pending, closing_amount, actual_amount_id, last_payment_date, fees_pending > 0 ? next_installment_date : null];

        await pool.query(query, values);

        res.redirect(`/students/add?success=${encodeURIComponent('Student added successfully')}`);
    } catch (error) {
        logger.error('Error adding student:', error);
        res.redirect(`/error=${encodeURIComponent("Error adding student")}`);
    }
});

app.get('/students/:id/edit', ensureAuthenticated, async (req, res) => {
    try {
        const { id } = req.params;
        const studentResult = await pool.query(`
            SELECT s.*, ay.year, b.batch_name, a.actual_amount
            FROM students s
            JOIN academic_years ay ON s.academic_year_id = ay.id
            LEFT JOIN batches b ON s.batch_id = b.id
            LEFT JOIN actual_amounts a ON s.actual_amount_id = a.id
            WHERE s.id = $1
        `, [id]);
        const student = studentResult.rows[0];
        const academicYears = await getAcademicYears();
        const batches = await getBatches();

        res.render('editStudent', {
            pageTitle: 'Edit Student', 
            student, 
            academicYears, 
            batches 
        });
    } catch (error) {
        logger.error('Error fetching student for edit:', error.message);
        res.redirect(`/error=${encodeURIComponent("Error fetching student for edit")}`);
    }
});

app.post('/students/:id/edit', ensureAuthenticated, async (req, res) => {
    try {
        const { id } = req.params;
        let { name, contact, academic_year_id, batch_id, fees_paid, fees_pending, last_payment_date, next_installment_date } = req.body;
        if (fees_pending == 0) {
            next_installment_date = null;
        }
        await pool.query(`
            UPDATE students
            SET name = $1, contact = $2, academic_year_id = $3, batch_id = $4, fees_paid = $5, last_payment_date = $6, fees_pending = $7, next_installment_date = $8
            WHERE id = $9
        `, [name, contact, academic_year_id, batch_id, fees_paid, last_payment_date, fees_pending, next_installment_date, id]);

        res.redirect(`/?success=${encodeURIComponent('Student data edited successfully')}`);
    } catch (error) {
        logger.error('Error updating student:', error.message);
        res.redirect(`/error=${encodeURIComponent("Error updating student! Please try again.")}`);
    }
});

app.delete('/students/:id/delete', ensureAuthenticated, async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query('DELETE FROM students WHERE id = $1', [id]);
        res.redirect(`/?success=${encodeURIComponent('Student deleted successfully')}`);
    } catch (error) {
        logger.error('Error deleting student:', error.message);
        res.redirect(`/error=${encodeURIComponent("Error deleting student! Please try again.")}`);
    }
});

app.get('/admin', ensureAuthenticated, async (req, res) => {
    try {
        const academicYears = await getAcademicYears();
        const batches = await getBatches();
        res.render('admin', { 
            pageTitle: 'Admin',
            academicYears, 
            batches 
        });
    } catch (error) {
        logger.error('Error fetching admin data:', error.message);
        error.status = 500;
        error.title = "Error fetching admin page";
        return next(error); 
    }
});

app.post('/admin/academic-years', ensureAuthenticated, async (req, res) => {
    try {
        const { academic_year } = req.body;
        await pool.query('INSERT INTO academic_years (year) VALUES ($1)', [academic_year]);
        res.redirect(`/admin?success=${encodeURIComponent("Academic year added successfully")}`);
    } catch (error) {
        logger.error('Error adding academic year:', error.message);
        res.redirect(`/admin?error=${encodeURIComponent("Error adding academic year")}`);
    }
});

app.post('/admin/batches', ensureAuthenticated, async (req, res) => {
    try {
        const { batch_name } = req.body;
        await pool.query('INSERT INTO batches (batch_name) VALUES ($1)', [batch_name]);
        res.redirect(`/admin?success=${encodeURIComponent("Batch added successfully")}`);
    } catch (error) {
        logger.error('Error adding batch:', error.message);
        res.redirect(`/admin?error=${encodeURIComponent("Error adding batch")}`);
    }
});

app.post('/admin/set-fees', ensureAuthenticated, async (req, res) => {
    try {
        const { academic_year_id, batch_id, actual_amount } = req.body;
        let actualAmountId;

        if (batch_id) {
            const result = await pool.query(
                'SELECT id FROM actual_amounts WHERE academic_year_id = $1 AND batch_id = $2',
                [academic_year_id, batch_id]
            );

            if (result.rows.length > 0) {
                await pool.query(
                    'UPDATE actual_amounts SET actual_amount = $1 WHERE academic_year_id = $2 AND batch_id = $3',
                    [actual_amount, academic_year_id, batch_id]
                );
                actualAmountId = result.rows[0].id;
            } else {
                const insertResult = await pool.query(
                    'INSERT INTO actual_amounts (academic_year_id, batch_id, actual_amount) VALUES ($1, $2, $3) RETURNING id',
                    [academic_year_id, batch_id, actual_amount]
                );
                actualAmountId = insertResult.rows[0].id;
            }

            await pool.query(
                'UPDATE students SET actual_amount_id = $1 WHERE academic_year_id = $2 AND batch_id = $3',
                [actualAmountId, academic_year_id, batch_id]
            );
        } else {
            const result = await pool.query(
                'SELECT id FROM actual_amounts WHERE academic_year_id = $1 AND batch_id IS NULL',
                [academic_year_id]
            );

            if (result.rows.length > 0) {
                await pool.query(
                    'UPDATE actual_amounts SET actual_amount = $1 WHERE academic_year_id = $2 AND batch_id IS NULL',
                    [actual_amount, academic_year_id]
                );
                actualAmountId = result.rows[0].id;
            } else {
                const insertResult = await pool.query(
                    'INSERT INTO actual_amounts (academic_year_id, actual_amount) VALUES ($1, $2) RETURNING id',
                    [academic_year_id, actual_amount]
                );
                actualAmountId = insertResult.rows[0].id;
            }

            await pool.query(
                'UPDATE students SET actual_amount_id = $1 WHERE academic_year_id = $2',
                [actualAmountId, academic_year_id]
            );

            const batches = await pool.query('SELECT id FROM batches');
            for (const batch of batches.rows) {
                const batchResult = await pool.query(
                    'SELECT id FROM actual_amounts WHERE academic_year_id = $1 AND batch_id = $2',
                    [academic_year_id, batch.id]
                );

                if (batchResult.rows.length > 0) {
                    await pool.query(
                        'UPDATE actual_amounts SET actual_amount = $1 WHERE academic_year_id = $2 AND batch_id = $3',
                        [actual_amount, academic_year_id, batch.id]
                    );
                    actualAmountId = batchResult.rows[0].id;
                } else {
                    const insertBatchResult = await pool.query(
                        'INSERT INTO actual_amounts (academic_year_id, batch_id, actual_amount) VALUES ($1, $2, $3) RETURNING id',
                        [academic_year_id, batch.id, actual_amount]
                    );
                    actualAmountId = insertBatchResult.rows[0].id;
                }

                await pool.query(
                    'UPDATE students SET actual_amount_id = $1 WHERE academic_year_id = $2 AND batch_id = $3',
                    [actualAmountId, academic_year_id, batch.id]
                );
            }
        }

        res.redirect(`/admin?success=${encodeURIComponent("Fees Updated Successfully")}`);
    } catch (error) {
        logger.error('Error updating fees:', error.message);
        res.redirect(`/admin?error=${encodeURIComponent("Error updating fees")}`);
    }
});

app.post('/admin/academic-years/:id/edit', ensureAuthenticated, async (req, res) => {
    try {
        const { id } = req.params;
        const { year } = req.body;
        await pool.query('UPDATE academic_years SET year = $1 WHERE id = $2', [year, id]);
        res.redirect(`/admin?success=${encodeURIComponent("Academic year updated successfully")}`);
    } catch (error) {
        logger.error('Error updating academic year:', error.message);
        res.redirect(`/admin?error=${encodeURIComponent("Error updating academic year")}`);
    }
});

app.post('/admin/batches/:id/edit', ensureAuthenticated, async (req, res) => {
    try {
        const { id } = req.params;
        const { batch_name } = req.body;
        await pool.query('UPDATE batches SET batch_name = $1 WHERE id = $2', [batch_name, id]);
        res.redirect(`/admin?success=${encodeURIComponent("Batch updated successfully")}`);
    } catch (error) {
        logger.error('Error updating batch:', error.message);
        res.redirect(`/admin?error=${encodeURIComponent("Error updating batch")}`);
    }
});

app.delete('/admin/academic-years/:id/delete', ensureAuthenticated, async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query('DELETE FROM academic_years WHERE id = $1', [id]);
        res.redirect(`/admin?success=${encodeURIComponent("Academic year deleted successfully")}`);
    } catch (error) {
        logger.error('Error deleting academic year:', error.message);
        res.redirect(`/admin?error=${encodeURIComponent("Error deleting academic year")}`);
    }
});

app.delete('/admin/batches/:id/delete', ensureAuthenticated, async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query('DELETE FROM batches WHERE id = $1', [id]);
        res.redirect(`/admin?success=${encodeURIComponent("Batch deleted successfully")}`);
    } catch (error) {
        logger.error('Error deleting batch:', error.message);
        res.redirect(`/admin?error=${encodeURIComponent("Error deleting batch")}`);
    }
});

app.use((err, req, res, next) => {
    logger.error('Error:', err.message);
    res.status(err.status || 500).render("error.ejs", {
        pageTitle: "Error",
        status: err.status || 500,
        title: err.title || 'Error',
        message: err.message || 'Something went wrong!'
    });
});

passport.use(
    new Strategy(async function verify(username, password, cb) {
        try {
            const result = await pool.query("SELECT * FROM users WHERE username = $1", [username]);

            if (result.rows.length === 0) {
                logger.warn("Login attempt for non-existing user:", username);
                return cb(null, false, { message: "User  not found" });
            }

            const user = result.rows[0];
            const storedPassword = user.password;

            const passwordMatch = await bcrypt.compare(password, storedPassword);
            
            if (passwordMatch) {
                return cb(null, user);
            } else {
                return cb(null, false, { message: "Incorrect password" });
            }
        } catch (err) {
            return cb(err);
        }
    })
);

passport.serializeUser ((user, cb) => {
    cb(null, user);
});

passport.deserializeUser ((user, cb) => {
    cb(null, user);
});


app.get("/health", async (req, res) => {
    try {
        const dbCheck = await pool.query("SELECT NOW() AS current_time");
        const memoryUsage = process.memoryUsage();
        const uptime = process.uptime();
        
        res.status(200).json({
            status: "ok",
            database: "connected",
            current_time: dbCheck.rows[0].current_time,
            memory: {
                rss: memoryUsage.rss,
                heapTotal: memoryUsage.heapTotal,
                heapUsed: memoryUsage.heapUsed,
                external: memoryUsage.external,
            },
            uptime: `${Math.floor(uptime / 60)}m ${Math.floor(uptime % 60)}s`
        });
    } catch (error) {
        logger.error("Health check failed:", error.message);
        res.status(500).json({
            status: "error",
            database: "disconnected",
            error: error.message
        });
    }
});

app.listen(PORT, (err) => {
    if (err) {
        logger.error('Error starting the server:', err.message);
    } else {
        logger.info(`Server running on ${PORT}`);
    }
});