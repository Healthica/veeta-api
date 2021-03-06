#!/usr/bin/env node
'use strict'

const env = require('node-env-file')
env(__dirname + '/../config/config.env')

const express = require('express')
const app = express()
const bodyParser = require('body-parser')
const flash = require('connect-flash')
const db = require('./utils/DbPool')
const uuid = require('uuid')
const _ = require('lodash')

const session = require('express-session')
const pgSession = require('connect-pg-simple')(session)
// Fixes support for db-pool - https://github.com/voxpelli/node-connect-pg-simple/issues/36
pgSession.prototype.query = function (query, params, fn) {
  if (!fn && typeof params === 'function') {
   fn = params
  }
  this.pg.connect(function (err, client, done) {
    if (err) {
      done(client)
      if (fn) {
        fn(err)
      }
    } else {
      client.query(query, params || [], function (err, result) {
        done(err || false)
        if (fn) {
          fn(err, result && result.rows[0] ? result.rows[0] : false);
        }
      })
    }
  })
}
app.set('trust proxy', true)
app.use(session({
  store: new pgSession({
    pg: db.pool,
    tableName: 'user_sessions'
  }),
  name: 'session',
  secret: process.env.COOKIE_SECRET,
  resave: false,
  saveUninitialized: true,
  cookie: { maxAge: parseInt(process.env.COOKIE_DAYS_TOEXPIRE, 10) * 24 * 60 * 60 * 1000 },
  genid: (req) => {
    return uuid.v4()
  }
}))

app.use(flash())
app.use(bodyParser.json())

// Allow CORS
if (process.env.ENV === 'development') {
  app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "http://localhost:3012")
    res.header("Access-Control-Allow-Credentials", "true")
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept")
    next()
  })
} else {
  //TODO set up production domain
}

const Users = require('./Models/Users')
Users.setDb(db.pool)
app.use((req, res, next) => Users.createGuest(req, res, next))

// Passport
const passport = require('passport')
const LocalStrategy = require('passport-local').Strategy
const ensureLogin = require('connect-ensure-login').ensureLoggedIn('/unauthorized')
passport.use(new LocalStrategy({
    usernameField: 'login',
    passwordField: 'password',
    session: true
  },
  (login, password, done) => {
    Users.checkPassword(login, password, (err, user) => {
      if (err) { return done(err) }
      if (!user) {
        return done(null, false, { message: 'Incorrect username or password' })
      }
      return done(null, user)
    })
  }
))
passport.serializeUser((user, done) => {
  done(null, { id: user.id })
})
passport.deserializeUser((user, done) => {
  Users.find({ id: user.id }, (err, user) => {
    done(null, user)
  })
})
app.use(passport.initialize())
app.use(passport.session())

app.post('/login', bodyParser.urlencoded({ extended: true }), passport.authenticate('local'), (req, res) => {
  req.session.user_id = req.user.id
  res.json({ success: true, user: _.pick(req.user, ['id', 'name', 'auth_by'])})
})
app.get('/logout', (req, res) => {
  req.logout()
  req.session.destroy((err) => {
    res.json({ success: err ? false : true })
  })
})
app.get('/unauthorized', (req, res) => {
  res.json({ success: false, errors: ['Unauthorized']})
})
app.post('/register', bodyParser.urlencoded({ extended: true }), (req, res) => {
  Users.register(req, (result) => {
    if (result.success === true) {
      Users.updateSession(req, (err, user) => {
        if (err) {
          res.json({ success: false })
        } else {
          res.json({ success: true, user: _.pick(user, ['id', 'name', 'auth_by']) })
        }
      })
    } else {
      res.json(result)
    }
  })
})
app.post('/profile/update', (req, res) => {
  Users.updateProfile(req, (result) => {
    res.json(result)
  })
})
app.get('/user', (req, res) => {
  const defaults = {
    id: req.session.user_id,
    name: 'Guest',
    auth_by: req.session.auth_by
  }
  if (!_.has(req.session, 'first_request')) {
    defaults.show_onboarding = true
  }
  res.json({
    success: true,
    user: Object.assign(defaults, _.pick(req.user, ['id', 'name', 'auth_by']))
  })
  req.session.first_request = false
  req.session.save()
})

const Events = require('./Models/Events')
const Charts = require('./Models/Charts')
Events.setDb(db.pool)
Charts.setDb(db.pool)

app.get('/', (req, res) => {
  res.json({ success: true })
})
app.get('/events', /*ensureLogin,*/ (req, res) => {
  Events.getEvents(req, res)
})
app.post('/events', /*ensureLogin,*/ (req, res) => {
  Events.postEvents(req, res)
})
app.get('/charts', /*ensureLogin,*/ (req, res) => {
  Charts.getCharts(req, res)
})
app.post('/charts', /*ensureLogin,*/ (req, res) => {
  Charts.postCharts(req, res)
})

const Download = require('./Models/Download')
Download.setDb(db.pool)
app.get('/download', (req, res) => {
  Download.getData(req, res)
})

app.listen(process.env.PORT)
console.log('Listening on port ' + process.env.PORT)
