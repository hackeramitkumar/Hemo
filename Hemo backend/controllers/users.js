const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const nodemailer = require("nodemailer");
const { v4: uuidv4 } = require("uuid");

const User = require("../model/user");
const {
  registerValidation,
  loginValidation,
  profileValidation,
} = require("../validation");
const UserVerifcation = require("../model/user_verification");
const createError = require("http-errors");

//nodemailer transpoter
let transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  service: "gmail",
  auth: {
    user: process.env.AUTH_EMAIL,
    pass: process.env.AUTH_PASS,
  },
});

// testing nodemailer
transporter.verify((error, success) => {
  if (error) {
    console.log(error);
  } else {
    console.log("Ready for messages");
    console.log(success);
  }
});

//deleting user
exports.user_delete = async (req, res, next)=>{
  try{
    const _id = req.query.user_id;
    const user = await User.findOneAndDelete({_id});
    if(user){
      res.status(200).send({
        status: 200,
        message: "Account deleted"
      })
    }else{
      next(createError(404, "User not found"))
    }
  }catch(error){
    next(error)
  }

}


//change Password
exports.user_change_password = async(req, res,next)=>{
  console.log("Change password called")
  try{
    const {user_id, old_password, new_password} = req.body;

    const user = await User.findOne({_id: user_id});

    const validPass = await bcrypt.compare(old_password, user.password);
    if (!validPass) {
      next(createError(400, "Incorrect password"));
      return;
    }

    //hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(new_password, salt);

    user.password = hashedPassword;
    await user.save();

    res.status(200).send({
      status: 200,
      message: "Password changed"
    })

  }catch(error){
    next(error)
  }
}

exports.user_edit_profile = async(req, res, next)=>{
  try{
    const{_id, location, weight, phone} = req.body;
    const user = await User.findOneAndUpdate({_id}, {location, weight, phone})
    if(user){
      res.status(200).send({
        status: 200,
        message: "Profile updated"
      })
    }else{
      next(404, "User not found")
    } 
  }catch(error){
    next(error)
  }
}

//find one user
exports.user_find_one = async (req, res, next) => {
  const { id } = req.params;
  console.log(id);
  //finding user
  try {
    const user = await User.findOne({ _id: id });
    if (user) {
      res.status(200).send(user);
    } else {
      throw createError(404, "Not found");
    }
  } catch (error) {
    next(error);
    return;
  }
};

//getting all users
exports.user_find_all = async (req, res, next) => {
  try {
    const users = await User.find();
    res.send(users);
  } catch (error) {
    next(error);
    return;
  }
};

// registering new user
exports.user_register = async (req, res, next) => {
  //validating user data
  const { valid, error } = registerValidation(req.body);

  if (!valid) {
    next(createError(400, error));
    return;
  }

  //checking if the user already exsist

  try {
    const emailExist = await User.findOne({ email: req.body.email });

    if (emailExist) {
      throw createError(400, "Email already exist");
      return;
    }
  } catch (err) {
    next(err);
    return;
  }

  //hash password
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(req.body.password, salt);

  //creating new user
  const user = new User({
    name: req.body.name,
    email: req.body.email,
    password: hashedPassword,
  });
  console.log(user);
  try {
    const savedUser = await user.save().then((result) => {
      console.log("Sending email");
      sendVerificationEmail(result, res);
    });
  } catch (err) {
    next(err);
    return;
  }
};

//login new user
exports.user_login = async (req, res, next) => {
  //validating user data
  const { valid, error } = loginValidation(req.body);

  if (!valid) {
    next(createError(400, error));
    return;
  }

  //checking if the email exsist
  try {
    const user = await User.findOne({ email: req.body.email });

    if (!user) {
      throw createError(404, "Incorrect Email");
    }

    if (!user.verified) {
      next(createError(401, "Email not verified"));
      return;
    }

    const validPass = await bcrypt.compare(req.body.password, user.password);
    if (!validPass) {
      next(createError(400, "Incorrect password"));
      return;
    }

    await User.updateOne({email: req.body.email}, {token: req.body.token})

    //create web token
    const token = jwt.sign({ _id: user._id }, process.env.TOKEN_SECRET);
    res.header("auth_token", token).send(user);
  } catch (error) {
    next(error);
    return;
  }
};

//create Profile
exports.user_create_profile = async (req, res, next) => {
  console.log("Request recieved");
  const { valid, error } = profileValidation(req.body);
  if (!valid) {
    console.log(error);
    next(createError(400, error));
    return;
  }

  try {
    const { email } = req.body;
    const { dob, location, weight, gender, blood, phone } = req.body;
    const user = await User.findOneAndUpdate(
      { email },
      { dob, location, weight, gender, blood, phone }
    );

    if (user) {
      res.status(200).send({
        status: 200,
        message: "Profile created",
      });
    } else {
      throw createError(404, "User not found");
    }
  } catch (error) {
    console.log(error);
    next(error);
  }
};

// verifying user email
exports.user_verify = async (req, res, next) => {
  const { us } = req.params;
  try {
    const user = await UserVerifcation.findOne({ uniqueString: us });
    if (user) {
      const tuser = await User.updateOne(
        { _id: user.userID },
        { verified: true }
      );
      if (tuser) {
        await UserVerifcation.deleteOne({ uniqueString: us });
        res.send("Verified");
      } else {
        res.send("Already verified");
      }
    } else {
      throw createError(404, "User not found");
    }
  } catch (error) {
    next(error);
    return;
  }
};


//send verification email
const sendVerificationEmail = ({ name, _id, email }, res, next) => {
  //url to be used in the email

  const uniqueString = uuidv4() + _id;
  const curUrl = "http://localhost:3000/" + "api/user/verify/" + uniqueString;

  var mailOptions = {
    from: process.env.AUTH_EMAIL,
    to: email,
    subject: "Email verification Hemo Dev334",
    html: `
        <head>
    <title></title>
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta http-equiv="X-UA-Compatible" content="IE=edge" />
    <style type="text/css">
        @media screen {
            @font-face {
                font-family: 'Lato';
                font-style: normal;
                font-weight: 400;
                src: local('Lato Regular'), local('Lato-Regular'), url(https://fonts.gstatic.com/s/lato/v11/qIIYRU-oROkIk8vfvxw6QvesZW2xOQ-xsNqO47m55DA.woff) format('woff');
            }

            @font-face {
                font-family: 'Lato';
                font-style: normal;
                font-weight: 700;
                src: local('Lato Bold'), local('Lato-Bold'), url(https://fonts.gstatic.com/s/lato/v11/qdgUG4U09HnJwhYI-uK18wLUuEpTyoUstqEm5AMlJo4.woff) format('woff');
            }

            @font-face {
                font-family: 'Lato';
                font-style: italic;
                font-weight: 400;
                src: local('Lato Italic'), local('Lato-Italic'), url(https://fonts.gstatic.com/s/lato/v11/RYyZNoeFgb0l7W3Vu1aSWOvvDin1pK8aKteLpeZ5c0A.woff) format('woff');
            }

            @font-face {
                font-family: 'Lato';
                font-style: italic;
                font-weight: 700;
                src: local('Lato Bold Italic'), local('Lato-BoldItalic'), url(https://fonts.gstatic.com/s/lato/v11/HkF_qI1x_noxlxhrhMQYELO3LdcAZYWl9Si6vvxL-qU.woff) format('woff');
            }
        }

        /* CLIENT-SPECIFIC STYLES */
        body,
        table,
        td,
        a {
            -webkit-text-size-adjust: 100%;
            -ms-text-size-adjust: 100%;
        }

        table,
        td {
            mso-table-lspace: 0pt;
            mso-table-rspace: 0pt;
        }

        img {
            -ms-interpolation-mode: bicubic;
        }

        /* RESET STYLES */
        img {
            border: 0;
            height: auto;
            line-height: 100%;
            outline: none;
            text-decoration: none;
        }

        table {
            border-collapse: collapse !important;
        }

        body {
            height: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
            width: 100% !important;
        }

        /* iOS BLUE LINKS */
        a[x-apple-data-detectors] {
            color: inherit !important;
            text-decoration: none !important;
            font-size: inherit !important;
            font-family: inherit !important;
            font-weight: inherit !important;
            line-height: inherit !important;
        }

        /* MOBILE STYLES */
        @media screen and (max-width:600px) {
            h1 {
                font-size: 32px !important;
                line-height: 32px !important;
            }
        }

        /* ANDROID CENTER FIX */
        div[style*="margin: 16px 0;"] {
            margin: 0 !important;
        }
    </style>
</head>

<body style="background-color: #f4f4f4; margin: 0 !important; padding: 0 !important;">
    <!-- HIDDEN PREHEADER TEXT -->
    <div style="display: none; font-size: 1px; color: #fefefe; line-height: 1px; font-family: 'Lato', Helvetica, Arial, sans-serif; max-height: 0px; max-width: 0px; opacity: 0; overflow: hidden;"> We're thrilled to have you here! Get ready to dive into your new account. </div>
    <table border="0" cellpadding="0" cellspacing="0" width="100%">
        <!-- LOGO -->
        <tr>
            <td bgcolor="#FFA73B" align="center">
                <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px;">
                    <tr>
                        <td align="center" valign="top" style="padding: 40px 10px 40px 10px;"> </td>
                    </tr>
                </table>
            </td>
        </tr>
        <tr>
            <td bgcolor="#FFA73B" align="center" style="padding: 0px 10px 0px 10px;">
                <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px;">
                    <tr>
                        <td bgcolor="#ffffff" align="center" valign="top" style="padding: 40px 20px 20px 20px; border-radius: 4px 4px 0px 0px; color: #111111; font-family: 'Lato', Helvetica, Arial, sans-serif; font-size: 48px; font-weight: 400; letter-spacing: 4px; line-height: 48px;">
                            <h1 style="font-size: 48px; font-weight: 400; margin: 2;">Welcome!</h1> <img src=" https://img.icons8.com/clouds/100/000000/handshake.png" width="125" height="120" style="display: block; border: 0px;" />
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
        <tr>
            <td bgcolor="#f4f4f4" align="center" style="padding: 0px 10px 0px 10px;">
                <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px;">
                    <tr>
                        <td bgcolor="#ffffff" align="left" style="padding: 20px 30px 40px 30px; color: #666666; font-family: 'Lato', Helvetica, Arial, sans-serif; font-size: 18px; font-weight: 400; line-height: 25px;">
                            <p style="margin: 0;">Hi ${name}, We're excited to have you get started. First, you need to confirm your account. Just press the button below.</p>
                        </td>
                    </tr>
                    <tr>
                        <td bgcolor="#ffffff" align="left">
                            <table width="100%" border="0" cellspacing="0" cellpadding="0">
                                <tr>
                                    <td bgcolor="#ffffff" align="center" style="padding: 20px 30px 60px 30px;">
                                        <table border="0" cellspacing="0" cellpadding="0">
                                            <tr>
                                                <td align="center" style="border-radius: 3px;" bgcolor="#FFA73B"><a href="${curUrl}" target="_blank" style="font-size: 20px; font-family: Helvetica, Arial, sans-serif; color: #ffffff; text-decoration: none; color: #ffffff; text-decoration: none; padding: 15px 25px; border-radius: 2px; border: 1px solid #FFA73B; display: inline-block;">Confirm Account</a></td>
                                            </tr>
                                        </table>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr> <!-- COPY -->
                    <tr>
                        <td bgcolor="#ffffff" align="left" style="padding: 0px 30px 0px 30px; color: #666666; font-family: 'Lato', Helvetica, Arial, sans-serif; font-size: 18px; font-weight: 400; line-height: 25px;">
                            <p style="margin: 0;">If that doesn't work, copy and paste the following link in your browser:</p>
                        </td>
                    </tr> <!-- COPY -->
                    <tr>
                        <td bgcolor="#ffffff" align="left" style="padding: 20px 30px 20px 30px; color: #666666; font-family: 'Lato', Helvetica, Arial, sans-serif; font-size: 18px; font-weight: 400; line-height: 25px;">
                            <p style="margin: 0;"><a href="#" target="_blank" style="color: #FFA73B;">${curUrl}</a></p>
                        </td>
                    </tr>
                    <tr>
                        <td bgcolor="#ffffff" align="left" style="padding: 0px 30px 20px 30px; color: #666666; font-family: 'Lato', Helvetica, Arial, sans-serif; font-size: 18px; font-weight: 400; line-height: 25px;">
                            <p style="margin: 0;">If you have any questions, just reply to this email—we're always happy to help out.</p>
                        </td>
                    </tr>
                    <tr>
                        <td bgcolor="#ffffff" align="left" style="padding: 0px 30px 40px 30px; border-radius: 0px 0px 4px 4px; color: #666666; font-family: 'Lato', Helvetica, Arial, sans-serif; font-size: 18px; font-weight: 400; line-height: 25px;">
                            <p style="margin: 0;">Cheers,<br>Dev334 </p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
        <tr>
            <td bgcolor="#f4f4f4" align="center" style="padding: 30px 10px 0px 10px;">
                <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px;">
                    <tr>
                        <td bgcolor="#FFECD1" align="center" style="padding: 30px 30px 30px 30px; border-radius: 4px 4px 4px 4px; color: #666666; font-family: 'Lato', Helvetica, Arial, sans-serif; font-size: 18px; font-weight: 400; line-height: 25px;">
                            <h2 style="font-size: 20px; font-weight: 400; color: #111111; margin: 0;">Need more help?</h2>
                            <p style="margin: 0;"><a href="mailto:oneon334@gmail.com" target="_blank" style="color: #FFA73B;">We&rsquo;re here to help you out</a></p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
        <tr>
            <td bgcolor="#f4f4f4" align="center" style="padding: 0px 10px 0px 10px;">
                <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px;">
                    <tr>
                        <td bgcolor="#f4f4f4" align="left" style="padding: 0px 30px 30px 30px; color: #666666; font-family: 'Lato', Helvetica, Arial, sans-serif; font-size: 14px; font-weight: 400; line-height: 18px;"> <br>
                            <p style="margin: 0;">If these emails get annoying, please feel free to <a href="#" target="_blank" style="color: #111111; font-weight: 700;">unsubscribe</a>.</p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>

        
       `,
  };
  transporter.sendMail(mailOptions, async function (error, response) {
    if (error) {
      next(error);
      return;
    } else {
      const userVerify = new UserVerifcation({
        userID: _id,
        uniqueString: uniqueString,
      });
      const savedVerify = await userVerify.save();
      console.log("message sent");
      console.log(savedVerify);
      res.status = 200;
      res.send({
        status: 200,
        message: "Email sent",
      });
    }
  });
};
