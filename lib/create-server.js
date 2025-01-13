module.exports = createServer

const express = require('express')
const fs = require('fs')
const https = require('https')
const http = require('http')
const solidWs = require('solid-ws')
const debug = require('./debug')
const createApp = require('./create-app')
const globalTunnel = require('global-tunnel-ng')

function createServer (argv, app) {
  argv = argv || {}
  app = app || express()
  const ldpApp = createApp(argv)
  const ldp = ldpApp.locals.ldp || {}
  let mount = argv.mount || '/'
  // Removing ending '/'
  if (mount.length > 1 &&
    mount[mount.length - 1] === '/') {
    mount = mount.slice(0, -1)
  }
  app.use(mount, ldpApp)
  debug.settings('Base URL (--mount): ' + mount)

  if (argv.idp) {
    console.warn('The idp configuration option has been renamed to multiuser.')
    argv.multiuser = argv.idp
    delete argv.idp
  }

  if (argv.httpProxy) {
    globalTunnel.initialize(argv.httpProxy)
  }

  let server
  const needsTLS = argv.sslKey || argv.sslCert
  if (!needsTLS) {
    server = http.createServer(app)
  } else {
    debug.settings('SSL Private Key path: ' + argv.sslKey)
    debug.settings('SSL Certificate path: ' + argv.sslCert)

    if (!argv.sslCert && !argv.sslKey) {
      throw new Error('Missing SSL cert and SSL key to enable WebIDs')
    }

    if (!argv.sslKey && argv.sslCert) {
      throw new Error('Missing path for SSL key')
    }

    if (!argv.sslCert && argv.sslKey) {
      throw new Error('Missing path for SSL cert')
    }

    let key
    try {
      key = fs.readFileSync(argv.sslKey)
    } catch (e) {
      throw new Error('Can\'t find SSL key in ' + argv.sslKey)
    }

    let cert
    try {
      cert = fs.readFileSync(argv.sslCert)
    } catch (e) {
      throw new Error('Can\'t find SSL cert in ' + argv.sslCert)
    }

    const credentials = Object.assign({
      key: key,
      cert: cert
    }, argv)

    if (ldp.webid && ldp.auth === 'tls') {
      credentials.requestCert = true
    }

    server = https.createServer(credentials, app)
  }

  // Look for port or list of ports to redirect to argv.port
  if ('redirectHttpFrom' in argv) {
    const redirectHttpFroms = argv.redirectHttpFrom.constructor === Array
      ? argv.redirectHttpFrom
      : [argv.redirectHttpFrom]
    const portStr = argv.port === 443 ? '' : ':' + argv.port
    redirectHttpFroms.forEach(redirectHttpFrom => {
      debug.settings('will redirect from port ' + redirectHttpFrom + ' to port ' + argv.port)
      const redirectingServer = express()
      redirectingServer.get('*', function (req, res) {
        const host = req.headers.host.split(':') // ignore port
        debug.server(host, '=> https://' + host + portStr + req.url)
        res.redirect('https://' + host + portStr + req.url)
      })
      redirectingServer.listen(redirectHttpFrom)
    })
  }

  // Setup Express app
  if (ldp.live) {
    const solidWebsocket = solidWs(server, ldpApp)
    ldpApp.locals.ldp.live = solidWebsocket.publish.bind(solidWebsocket)
  }

  return server
}
