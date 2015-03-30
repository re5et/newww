var generateCrumb = require("../crumb"),
    Code = require('code'),
    Lab = require('lab'),
    lab = exports.lab = Lab.script(),
    describe = lab.experiment,
    before = lab.before,
    after = lab.after,
    it = lab.test,
    expect = Code.expect,
    nock = require('nock'),
    users = require('../../fixtures').users;

var server;


before(function (done) {
  require('../../mocks/server')(function (obj) {
    server = obj;
    done();
  });
});

after(function (done) {
  server.stop(done);
});

describe('Getting to the profile-edit page', function () {
  it('redirects an unauthorized user to the login page', function (done) {
    var options = {
      url: '/profile-edit'
    };

    server.inject(options, function (resp) {
      expect(resp.statusCode).to.equal(302);
      expect(resp.headers.location).to.include('login');
      done();
    });
  });

  it('takes authorized users to the profile-edit page', function (done) {
    var options = {
      url: '/profile-edit',
      credentials: users.bob
    };

    server.inject(options, function (resp) {
      expect(resp.statusCode).to.equal(200);
      var source = resp.request.response.source;
      expect(source.template).to.equal('user/profile-edit');
      done();
    });
  });
});

describe('Modifying the profile', function () {
  it('redirects an unauthorized user to the login page', function (done) {
    var options = {
      url: '/profile-edit',
      method: 'POST',
      payload: users.profileUpdate
    };

    server.inject(options, function (resp) {
      expect(resp.statusCode).to.equal(302);
      expect(resp.headers.location).to.include('login');
      done();
    });
  });

  it('rejects profile modifications that don\'t include CSRF data', function (done) {
    var options = {
      url: '/profile-edit',
      method: 'POST',
      payload: users.profileUpdate,
      credentials: users.bob
    };

    server.inject(options, function (resp) {
      expect(resp.statusCode).to.equal(403);
      done();
    });
  });

  it('allows authorized profile modifications and redirects to profile page', function (done) {

    generateCrumb(server, function (crumb){
      var mock = nock('https://user-api-example.com')
        .post('/user/' + users.bob.name, users.bobUpdateBody)
        .reply(200, users.bobUpdated)
        .get('/user/' + users.bob.name)
        .reply(200, users.bobUpdated)
        .get('/user/' + users.bob.name + '/package?per_page=9999')
        .reply(200, users.packages)
        .get('/user/' + users.bob.name + '/stars')
        .reply(200, users.stars);

      var options = {
        url: '/profile-edit',
        method: 'POST',
        payload: users.profileUpdate,
        credentials: users.bob,
        headers: { cookie: 'crumb=' + crumb }
      };

      options.payload.crumb = crumb;

      server.inject(options, function (resp) {
        expect(resp.statusCode).to.equal(302);
        expect(resp.headers.location).to.include('profile');

        // now let's make sure it's calling to the user-acl for the
        // updated version
        options = {
          url: resp.headers.location,
          credentials: users.bob,
        };

        server.inject(options, function (resp) {
          mock.done();
          expect(resp.statusCode).to.equal(200);
          var context = resp.request.response.source.context;
          expect(context.profile.name).to.equal("bob");
          expect(context.profile.resource.github).to.equal(users.profileUpdate.github);
          expect(context.profile.resource.twitter).to.equal(users.profileUpdate.twitter);
          done();
        });
      });
    });
  });

  it('rejects _id, name, and email from the payload', function (done) {
    generateCrumb(server, function (crumb){
      var options = {
        url: '/profile-edit',
        method: 'POST',
        payload: users.profileUpdate,
        credentials: users.bob,
        headers: { cookie: 'crumb=' + crumb }
      };

      options.payload.crumb = crumb;

      options.payload.name = 'badguy';
      options.payload.email = 'badguy@bad.com';

      server.inject(options, function (resp) {
        expect(resp.statusCode).to.equal(400);
        var source = resp.request.response.source;
        expect(source.context.error).to.exist();
        expect(source.context.error.details).to.be.an.array();
        var names = source.context.error.details.map(function(detail){
          return detail.path;
        });
        expect(names).to.include('name');
        expect(names).to.include('email');
        expect(source.template).to.equal('user/profile-edit');
        done();
      });
    });
  });
});
