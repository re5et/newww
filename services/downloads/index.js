var SECOND = 1000;

exports.register = function Downloads (server, options, next) {

  var opts = {};
  if (process.env.USE_CACHE) {
    opts.cache = {
      staleTimeout: 1 * SECOND, // don't wait more than a second for fresh data
      staleIn: 60 * 60 * SECOND, // refresh after an hour
      segment: '##packagedownloads'
    }
  };

  server.method('downloads.getAll', function(packageName) {
    return require('../../models/download').new().getAll(packageName);
  }, opts);

  return next();
};

exports.register.attributes = {
  "name": "downloads",
  "version": "1.0.0",
};
