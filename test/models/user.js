var Code = require('code'),
    Lab = require('lab'),
    lab = exports.lab = Lab.script(),
    describe = lab.experiment,
    beforeEach = lab.beforeEach,
    afterEach = lab.afterEach,
    before = lab.before,
    after = lab.after,
    it = lab.test,
    expect = Code.expect,
    nock = require("nock"),
    sinon = require("sinon"),
    cache = require("../../lib/cache");

var fixtures = {
  users: require("../fixtures/users")
};

var User, spy;

beforeEach(function (done) {
  User = new (require("../../models/user"))({
    host: "https://user.com"
  });
  spy = sinon.spy(function (a, b, c) {});
  User.getMailchimp = function () {return {lists: {subscribe: spy}}};
  done();
});

afterEach(function (done) {
  User = null;
  done();
});

before(function (done) {
  process.env.USE_CACHE = 'true';
  cache.configure({
    redis: "redis://localhost:6379",
    ttl: 5,
    prefix: "cache:"
  });
  done();
});

after(function (done) {
  delete process.env.USE_CACHE;
  cache.disconnect(done);
});

describe("User", function(){

  describe("initialization", function() {
    it("defaults to process.env.USER_API as host", function(done) {
      var USER_API_OLD = process.env.USER_API;
      process.env.USER_API = "https://envy.com/";
      expect(new (require("../../models/user"))().host).to.equal('https://envy.com/');
      process.env.USER_API = USER_API_OLD;
      done();
    });

    it("accepts a custom host", function(done) {
      expect(User.host).to.equal('https://user.com');
      done();
    });

  });

  describe("login", function () {

    it("makes an external request for /{user}/login", function (done) {
      var userMock = nock(User.host)
        .post('/user/bob/login')
        .reply(200, fixtures.users.bob);

      var loginInfo = {
        name: 'bob',
        password: '12345'
      };

      User.login(loginInfo, function (err, user) {
        expect(err).to.be.null();
        expect(user).to.exist();
        userMock.done();
        done();
      });
    });
  });

  describe("verifyPassword", function () {
    it("is essentially login with separated params", function (done) {
      var bob = fixtures.users.bob;

      var userMock = nock(User.host)
        .post('/user/'+ bob.name + '/login')
        .reply(200, bob);

      User.verifyPassword(bob.name, '12345', function (err, user) {
        expect(err).to.be.null();
        expect(user).to.exist();
        userMock.done();
        done();
      });
    });
  });

  describe("generate options for user ACL", function (done) {
    it("formats the options object for request/cache", function (done) {
      var obj = User.generateUserACLOptions('foobar');
      expect(obj).to.be.an.object();
      expect(obj.url).to.equal('https://user.com/user/foobar');
      expect(obj.json).to.be.true();
      done();
    });
  });

  describe("get()", function() {

    it("makes an external request for /{user} and returns the response body in the callback", function(done) {
      var userMock = nock(User.host)
        .get('/user/bob')
        .reply(200, fixtures.users.bob);

      User.get(fixtures.users.bob.name, function(err, body) {
        expect(err).to.be.null();
        expect(body).to.exist();
        expect(body.name).to.equal("bob");
        expect(body.email).to.exist();
        userMock.done();
        done();
      });
    });

    it("doesn't make another external request due to caching", function(done) {
      // no need for nock because no request will be made

      User.get(fixtures.users.bob.name, function(err, body) {
        expect(err).to.be.null();
        expect(body).to.exist();
        expect(body.name).to.equal("bob");
        expect(body.email).to.exist();
        done();
      });
    });

    it("makes the external request again if the cache is dropped", function (done) {
      var userMock = nock(User.host)
        .get('/user/bob')
        .reply(200, fixtures.users.bob);

      User.drop(fixtures.users.bob.name, function (err) {
        expect(err).to.not.exist();

        User.get(fixtures.users.bob.name, function(err, body) {
          expect(err).to.be.null();
          expect(body.name).to.equal("bob");
          userMock.done();
          done();
        });
      });
    });

    it("returns an error in the callback if the request failed", function(done) {
      var userMock = nock(User.host)
        .get('/user/foo')
        .reply(404);

      User.get('foo', function(err, body) {
        expect(err).to.exist();
        expect(err.message).to.equal("unexpected status code 404");
        expect(body).to.not.exist();
        userMock.done();
        done();
      });
    });

    it("does not require a bearer token", function(done) {
      var userMock = nock(User.host, {reqheaders: {}})
        .get('/user/dogbreath')
        .reply(200);

      User.get('dogbreath', function(err, body) {
        expect(err).to.be.null();
        expect(body).to.exist();
        userMock.done();
        done();
      });
    });

    it("allows loading user stars and packages too", function(done) {

      var userMock = nock(User.host)
        .get('/user/eager-beaver')
        .reply(200, {
          name: "eager-beaver",
          email: "eager-beaver@example.com"
        });

      var starMock = nock(User.host)
        .get('/user/eager-beaver/stars')
        .reply(200, [
          'minimist',
          'hapi'
        ]);

      var packageMock = nock(User.host)
        .get('/user/eager-beaver/package?per_page=9999')
        .reply(200, [
          {name: "foo", description: "It's a foo!"},
          {name: "bar", description: "It's a bar!"}
        ]);

      User.get('eager-beaver', {stars: true, packages: true}, function(err, user) {
        expect(err).to.not.exist();
        userMock.done();
        packageMock.done();
        starMock.done();
        expect(user.name).to.equal('eager-beaver');
        expect(user.email).to.equal('eager-beaver@example.com');
        expect(user.packages).to.be.an.array();
        expect(user.stars).to.be.an.array();
        done();
      });

    });

    it("includes the bearer token if user is logged in when loading user stars and packages", function(done) {

      User = new (require("../../models/user"))({
        host: "https://user.com",
        bearer: "rockbot"
      });

      // no userMock here because yay caching

      var starMock = nock(User.host, {
          reqheaders: {bearer: 'rockbot'}
        })
        .get('/user/eager-beaver/stars')
        .reply(200, [
          'minimist',
          'hapi'
        ]);

      var packageMock = nock(User.host, {
          reqheaders: {bearer: 'rockbot'}
        })
        .get('/user/eager-beaver/package?per_page=9999')
        .reply(200, [
          {name: "foo", description: "It's a foo!"},
          {name: "bar", description: "It's a bar!"}
        ]);

      User.get('eager-beaver', {stars: true, packages: true}, function(err, user) {
        expect(err).to.not.exist();
        packageMock.done();
        starMock.done();
        expect(user.name).to.equal('eager-beaver');
        expect(user.email).to.equal('eager-beaver@example.com');
        expect(user.packages).to.be.an.array();
        expect(user.stars).to.be.an.array();
        done();
      });

    });

  });

  describe("getPackages()", function() {

    it("makes an external request for /{user}/package", function(done) {
      var packageMock = nock(User.host)
        .get('/user/bob/package?per_page=9999')
        .reply(200, []);

      User.getPackages(fixtures.users.bob.name, function(err, body) {
        packageMock.done();
        expect(err).to.be.null();
        expect(body).to.exist();
        done();
      });
    });

    it("returns the response body in the callback", function(done) {
      var packageMock = nock(User.host)
        .get('/user/bob/package?per_page=9999')
        .reply(200, [
          {name: "foo", description: "It's a foo!"},
          {name: "bar", description: "It's a bar!"}
        ]);

      User.getPackages(fixtures.users.bob.name, function(err, body) {
        expect(err).to.be.null();
        expect(body).to.be.an.array();
        expect(body[0].name).to.equal("foo");
        expect(body[1].name).to.equal("bar");
        packageMock.done();
        done();
      });
    });

    it("returns an error in the callback if the request failed", function(done) {
      var packageMock = nock(User.host)
        .get('/user/foo/package?per_page=9999')
        .reply(404);

      User.getPackages('foo', function(err, body) {
        expect(err).to.exist();
        expect(err.message).to.equal("error getting packages for user foo");
        expect(err.statusCode).to.equal(404);
        expect(body).to.not.exist();
        packageMock.done();
        done();
      });
    });

    it("includes bearer token in request header if user is logged in", function(done) {

      User = new (require("../../models/user"))({
        host: "https://user.com",
        bearer: "sally"
      });

      var packageMock = nock(User.host, {
          reqheaders: {bearer: 'sally'}
        })
        .get('/user/sally/package?per_page=9999')
        .reply(200, [
          {name: "foo", description: "It's a foo!"},
          {name: "bar", description: "It's a bar!"}
        ]);

      User.getPackages('sally', function(err, body) {
        expect(err).to.be.null();
        expect(body).to.exist();
        packageMock.done();
        done();
      });
    });

    it("does not include bearer token in request header if user is not logged in", function(done) {
      var packageMock = nock(User.host)
        .get('/user/sally/package?per_page=9999')
        .reply(200, [
          {name: "foo", description: "It's a foo!"},
          {name: "bar", description: "It's a bar!"}
        ]);

      User.getPackages('sally', function(err, body) {
        expect(err).to.be.null();
        expect(body).to.exist();
        packageMock.done();
        done();
      });
    });
  });

  describe("getStars()", function() {

    it("makes an external request for /{user}/stars", function(done) {
      var starMock = nock(User.host)
        .get('/user/bcoe/stars')
        .reply(200, ['lodash', 'nock', 'yargs']);

      User.getStars('bcoe', function(err, body) {
        starMock.done();
        expect(err).to.be.null();
        expect(body).to.exist();
        done();
      });
    });

    it("returns the response body in the callback", function(done) {
      var starMock = nock(User.host)
        .get('/user/ceej/stars')
        .reply(200, ['blade', 'minimist']);

      User.getStars('ceej', function(err, body) {
        expect(err).to.be.null();
        expect(body).to.be.an.array();
        expect(body[0]).to.equal("blade");
        expect(body[1]).to.equal("minimist");
        starMock.done();
        done();
      });
    });

    it("returns an error in the callback if the request failed", function(done) {
      var starMock = nock(User.host)
        .get('/user/zeke/stars')
        .reply(404);

      User.getStars('zeke', function(err, body) {
        starMock.done();
        expect(err).to.exist();
        expect(err.message).to.equal("error getting stars for user zeke");
        expect(err.statusCode).to.equal(404);
        expect(body).to.not.exist();
        done();
      });
    });

    it("includes bearer token in request header if user is logged in", function(done) {

      User = new (require("../../models/user"))({
        host: "https://user.com",
        bearer: "rod11"
      });

      var starMock = nock(User.host, {
          reqheaders: {bearer: 'rod11'}
        })
        .get('/user/rod11/stars')
        .reply(200, 'something');

      User.getStars('rod11', function(err, body) {
        expect(err).to.be.null();
        expect(body).to.exist();
        starMock.done();
        done();
      });
    });

    it("does not include bearer token in request header if user is not logged in", function(done) {
      var starMock = nock(User.host)
        .get('/user/rod11/stars')
        .reply(200, 'something');

      User.getStars('rod11', function(err, body) {
        expect(err).to.be.null();
        expect(body).to.exist();
        starMock.done();
        done();
      });
    });
  });

  describe("lookup users by email", function () {
    it("returns an error for invalid email addresses", function (done) {
      User.lookupEmail('barf', function (err, usernames) {
        expect(err).to.exist();
        expect(err.statusCode).to.equal(400);
        expect(usernames).to.be.undefined();
        done();
      });
    });

    it("returns an array of email addresses", function (done) {
      var lookupMock = nock(User.host)
        .get('/user/ohai@boom.com')
        .reply(200, ['user', 'user2']);

      User.lookupEmail('ohai@boom.com', function (err, usernames) {
        expect(err).to.not.exist();
        expect(usernames).to.be.an.array();
        expect(usernames[0]).to.equal('user');
        expect(usernames[1]).to.equal('user2');
        lookupMock.done();
        done();
      });
    });

    it("passes any errors on to the controller", function (done) {
      var lookupMock = nock(User.host)
        .get('/user/ohai@boom.com')
        .reply(400, []);

      User.lookupEmail('ohai@boom.com', function (err, usernames) {
        expect(err).to.exist();
        expect(err.statusCode).to.equal(400);
        expect(usernames).to.not.exist();
        lookupMock.done();
        done();
      });
    });
  });

  describe("signup", function () {
    var signupInfo = {
      name: 'hello',
      password: '12345',
      email: 'hello@hi.com'
    };

    var userObj = {
      name: signupInfo.name,
      email: "hello@hi.com"
    };

    it("passes any errors along", function (done) {
      var signupMock = nock(User.host)
        .put('/user', signupInfo)
        .reply(400);

      User.signup(signupInfo, function (err, user) {
        expect(err).to.exist();
        expect(err.statusCode).to.equal(400);
        expect(user).to.not.exist();
        signupMock.done();
        done();
      });
    });

    it("returns a user object when successful", function (done) {
      var signupMock = nock(User.host)
        .put('/user', signupInfo)
        .reply(200, userObj);

      User.signup(signupInfo, function (err, user) {
        expect(err).to.not.exist();
        expect(user).to.exist();
        expect(user.name).to.equal(signupInfo.name);
        signupMock.done();
        done();
      });
    });

    describe('the mailing list checkbox', function () {
      var params = { id: 'e17fe5d778', email: {email:'boom@boom.com'} };

      it('adds the user to the mailing list when checked', function (done) {
        spy.reset();
        User.signup({
          name: 'boom',
          password: '12345',
          verify: '12345',
          email: 'boom@boom.com',
          npmweekly: "on"
        }, function (er, user) {
          expect(spy.calledWith(params)).to.be.true();
          done();
        });
      });

      it('does not add the user to the mailing list when unchecked', function (done) {
        spy.reset();
        User.getMailchimp = function () {return {lists: {subscribe: spy}}};

        User.signup({
          name: 'boom',
          password: '12345',
          verify: '12345',
          email: 'boom@boom.com'
        }, function (er, user) {
          expect(spy.called).to.be.false();
          done();
        });
      });
    });
  });

  describe("save", function () {
    var profile = {
      name: "npmjs",
      resources: {
        twitter: "npmjs",
        github: ""
      }
    };

    var userObj = {
      name: "npmjs",
      email: "support@npmjs.com",
      resources: {
        twitter: "npmjs",
        github: ""
      }
    };

    it("bubbles up any errors that might occur", function (done) {
      var saveMock = nock(User.host)
        .post('/user/npmjs', profile)
        .reply(400);

      User.save(profile, function (err, user) {
        expect(err).to.exist();
        expect(err.statusCode).to.equal(400);
        expect(user).to.not.exist();
        saveMock.done();
        done();
      });
    });

    it("hits the save url", function (done) {
      var saveMock = nock(User.host)
        .post('/user/npmjs', profile)
        .reply(200, userObj);

      User.save(profile, function (err, user) {
        expect(err).to.not.exist();
        expect(user).to.exist();
        expect(user.name).to.equal('npmjs');
        expect(user.email).to.equal('support@npmjs.com');
        saveMock.done();
        done();
      });
    });
  });
});
