var request = require('request'),
    log = require('bole')('npme-get-license'),
    config = require('../../../config')

module.exports = function (productId, customerId, callback) {

  var licenseEndpoint = config.license.api + '/license';

  request.get({
    url: licenseEndpoint + '/' + productId + '/' + customerId,
    json: true
  }, function (er, resp, body) {

    if (resp.statusCode === 404) {
      return callback(null, null); // no error, but no license either
    }

    if (resp.statusCode === 200) {
      log.info("found licenses ", body);
      return callback(null, body.licenses);
    }

    log.error('unexpected status code from hubspot; status=' + resp.statusCode + '; customer=' + customerId);
    callback(new Error('unexpected status code: ' + resp.statusCode));
  });
}
