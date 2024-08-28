module.exports = handler

const libPath = require('path/posix')

const headerTemplate = require('express-prep/templates').header
const solidRDFTemplate = require('../rdf-notification-template')

const ALLOWED_RDF_MIME_TYPES = [
  'application/ld+json',
  'application/activity+json',
  'text/turtle'
]

function getActivity (method) {
  if (method === 'DELETE') {
    return 'Delete'
  }
  return 'Update'
}

function getParentActivity (method, status) {
  if (method === 'DELETE') {
    return 'Remove'
  }
  if (status === 201) {
    return 'Add'
  }
  return 'Update'
}

function handler (req, res, next) {
  const { trigger, defaultNotification } = res.events.prep

  const { method } = req
  const { statusCode } = res
  const eventID = res.getHeader('event-id')

  const parent = `${libPath.dirname(req.path)}/`
  const parentID = res.setEventID(parent)
  const fullUrl = new URL(req.path, `${req.protocol}://${req.hostname}/`)
  const parentUrl = new URL(parent, fullUrl)

  // Date is a hack since node does not seem to provide access to send date.
  // Date needs to be shared with parent notification
  const eventDate = res._header.match(/^Date: (.*?)$/m)?.[1] ||
    new Date().toUTCString()

  // If the resource itself newly created,
  // it could not have been subscribed for notifications already
  if (!((method === 'PUT' || method === 'PATCH') && statusCode === 201)) {
    trigger({
      generateNotification (
        negotiatedFields
      ) {
        const mediaType = negotiatedFields['content-type']

        if (ALLOWED_RDF_MIME_TYPES.includes(mediaType?.[0])) {
          return `${headerTemplate(negotiatedFields)}\r\n${solidRDFTemplate({
            activity: getActivity(method),
            eventID,
            object: String(fullUrl),
            date: eventDate,
            // We use eTag as a proxy for state for now
            state: res.getHeader('ETag'),
            mediaType
          })}`
        } else {
          return defaultNotification({
            ...(res.method === 'POST') && { location: res.getHeader('Content-Location') }
          })
        }
      }
    })
  }

  // Write a notification to parent container
  // POST in Solid creates a child resource
  if (method !== 'POST') {
    trigger({
      path: parent,
      generateNotification (
        negotiatedFields
      ) {
        const mediaType = negotiatedFields['content-type']
        if (ALLOWED_RDF_MIME_TYPES.includes(mediaType?.[0])) {
          return `${headerTemplate(negotiatedFields)}\r\n${solidRDFTemplate({
            activity: getParentActivity(method, statusCode),
            eventID: parentID,
            date: eventDate,
            object: String(parentUrl),
            target: statusCode === 201 ? String(fullUrl) : undefined,
            eTag: undefined,
            mediaType
          })}`
        }
      }
    })
  }

  next()
}
