var $ = require('../vendor/js/jquery-2.0.0.min');
var ko = require('knockout');
var ProgressBarViewModel = require('./controls').ProgressBarViewModel;
var RepositoryViewModel = require('./repository').RepositoryViewModel;
var addressParser = require('../../source/address-parser');
var signals = require('signals');
var gitLib = require('../js/github/github');


function HomeRepositoryViewModel(home, path) {
  this.home = home;
  this.app = home.app;
  this.path = path;
  this.title = path;
  this.link = '/#/repository?path=' + encodeURIComponent(path);
  this.pathRemoved = ko.observable(false);
  this.remote = ko.observable('...');
  this.basename = ko.computed(function() {
    if (this.path.length > 0) {
      return this.path.split('/').reverse()[0];
    }
  }, this);
  this.updateState();
}
HomeRepositoryViewModel.prototype.updateState = function() {
  var self = this;
  this.app.get('/fs/exists?path=' + encodeURIComponent(this.path), undefined, function(err, exists) {
    self.pathRemoved(!exists);
  });
  this.app.get('/remotes/origin?path=' + encodeURIComponent(this.path), undefined, function(err, remote) {
    if (err) {
      self.remote('');
      return true;
    }
    self.remote(remote.address);
  });
}
HomeRepositoryViewModel.prototype.remove = function() {
  var repos = this.app.repoList();
  var i;
  while((i = repos.indexOf(this.path)) != -1)
    repos.splice(i, 1);
  this.app.repoList(repos);
  this.home.update();
}

function HomeViewModel(app) {
  var self = this;
  this.app = app;
  this.repos = ko.observable([]);
  this.showNux = ko.computed(function() {
    return self.repos().length == 0;
  });
  this.newRepo = ko.observable({
    username: this.app.gitConfig().user,
    password: "",
    project: "",
    location: this.app.gitConfig().location.remote
  });
}
exports.HomeViewModel = HomeViewModel;
HomeViewModel.prototype.template = 'home';
HomeViewModel.prototype.shown = function() {
  this.update();
}
HomeViewModel.prototype.update = function() {
  var self = this;
  var reposByPath = {};
  this.repos().forEach(function(repo) { reposByPath[repo.path] = repo; });
  this.repos(this.app.repoList().sort().map(function(path) {
    if (!reposByPath[path])
      reposByPath[path] = new HomeRepositoryViewModel(self, path);
    return reposByPath[path];
  }));
}


var repoStatusShow;
var repoStatusShow = function(status) {
  $('#repo-status').html(status).show();
}

var repoStatusHide;
var repoStatusHide = function() {
  $('#repo-status').hide();
}

var hideModal;
var hideModal = function() {
  $('#modalCreateProject').modal('hide');
}

HomeViewModel.prototype.createRepo = function(data) {

  // context
  var self = this;
  var app = this.app;
  var gitConfig = this.app.gitConfig();

  // visual feedback: spinner
  var spinner = '<img src="images/ajax-loader.gif">';
  var status = 'Creating '+self.newRepo().project+'...<BR>'+spinner;
  repoStatusShow(status);

  // establish gh connection
  var github = new gitLib.Github({
    username: self.newRepo().username,
    password: self.newRepo().password,
    api_url: 'https://'+gitConfig.location.remote+'/api/v3'
  });

  // retrieve the current user and repos
  var gitUser = github.getUser(self.newRepo().username);
  gitUser.repos(function(err, r) {

    if (err) {
      status = 'ERROR CODE '+err.error;
      repoStatusShow(status);
    }

    else {
      // retrieve placeholder repo (necessary for library syntax)
      var repo = github.getRepo(self.newRepo().username, r[0].name);

      // create a new repo
      repo.createRepo({name: self.newRepo().project}, function(err, r) {
        if (err) {
          status = 'ERROR CODE '+err.error;
          repoStatusShow(status);
        }
        else {

          // context for remote/local repo
          var pathLocal = gitConfig.location.local+'/'+gitConfig.user+'/'+self.newRepo().project;
          var pathRemote = r.clone_url;

          // add repository to favorites
          var repos = app.repoList();
          if (repos.indexOf(pathLocal) == -1) {
            repos.push(pathLocal);
            app.repoList(repos);
          }

          // make directory (if it doesn't exist already)
          app.post('/git/repo/mkdir', { path: pathLocal }, function(err, res) {
            if (err) {
              status = 'ERROR CODE '+err.error;
              repoStatusShow(status);
            }
            // on successful directory creation, clone the repo
            else if (res.ok) {
              app.post('/clone', { path: pathLocal, url: pathRemote, destinationDir: pathLocal }, function(err_clone, res) {
                if (err_clone) return;
                hideModal();
                app.browseTo('repository?path=' + encodeURIComponent(pathLocal));
              });
            }
          });

        }
      });
    }
  });
}

var CrashViewModel = function() {
}
exports.CrashViewModel = CrashViewModel;
CrashViewModel.prototype.template = 'crash';


var UserErrorViewModel = function(args) {
  if (typeof(arguments[0]) == 'string')
    args = { title: arguments[0], details: arguments[1] };
  args = args || {};
  this.title = ko.observable(args.title);
  this.details = ko.observable(args.details);
}
exports.UserErrorViewModel = UserErrorViewModel;
UserErrorViewModel.prototype.template = 'usererror';


var PathViewModel = function(app, path) {
  var self = this;
  this.app = app;
  this.path = path;
  this.status = ko.observable('loading');
  this.loadingProgressBar = new ProgressBarViewModel('path-loading-' + path);
  this.loadingProgressBar.start();
  this.cloningProgressBar = new ProgressBarViewModel('path-loading-' + path, 10000);
  this.cloneUrl = ko.observable();
  this.cloneDestinationImplicit = ko.computed(function() {
    var defaultText = 'destination folder';
    if (!self.cloneUrl()) return defaultText;

    var parsedAddress = addressParser.parseAddress(self.cloneUrl());
    return parsedAddress.shortProject || defaultText;
  });
  this.cloneDestination = ko.observable();
  this.repository = ko.observable();
}
exports.PathViewModel = PathViewModel;
PathViewModel.prototype.template = 'path';
PathViewModel.prototype.shown = function() {
  this.updateStatus();
}
PathViewModel.prototype.updateAnimationFrame = function(deltaT) {
  if (this.repository())
    this.repository().updateAnimationFrame(deltaT);
}
PathViewModel.prototype.updateStatus = function() {
  var self = this;
  this.app.get('/quickstatus', { path: this.path }, function(err, status){
    self.loadingProgressBar.stop();
    if (err) return;
    if (status == 'inited') {
      self.status('repository');
      self.repository(new RepositoryViewModel(self.app, self.path));
    } else if (status == 'uninited') {
      self.status('uninited');
    } else if (status == 'no-such-path') {
      self.status('invalidpath');
    }
  });
}
PathViewModel.prototype.initRepository = function() {
  var self = this;
  this.app.post('/init', { path: this.path }, function(err, res) {
    if (err) return;
    self.updateStatus();
  });
}
PathViewModel.prototype.cloneRepository = function() {
  var self = this;
  self.status('cloning');
  this.cloningProgressBar.start();
  var dest = this.cloneDestination() || this.cloneDestinationImplicit();

  var programEventListener = function(event) {
    if (event.event == 'credentialsRequested') self.cloningProgressBar.pause();
    else if (event.event == 'credentialsProvided') self.cloningProgressBar.unpause();
  };
  this.app.programEvents.add(programEventListener);

  this.app.post('/clone', { path: this.path, url: this.cloneUrl(), destinationDir: dest }, function(err, res) {
    self.app.programEvents.remove(programEventListener);
    self.cloningProgressBar.stop();
    if (err) return;
    self.app.browseTo('repository?path=' + encodeURIComponent(res.path));
  });
}


var LoginViewModel = function(app) {
  var self = this;
  this.app = app;
  this.loggedIn = new signals.Signal();
  this.status = ko.observable('loading');
  this.username = ko.observable();
  this.password = ko.observable();
  this.loginError = ko.observable();
  this.app.get('/loggedin', undefined, function(err, status) {
    if (status.loggedIn) {
      self.loggedIn.dispatch();
      self.status('loggedIn');
    }
    else self.status('login');
  });
}
exports.LoginViewModel = LoginViewModel;
LoginViewModel.prototype.login = function() {
  var self = this;
  this.app.post('/login', { username: this.username(), password: this.password() }, function(err, res) {
    if (err) {
      if (err.res.body.error) {
        self.loginError(err.res.body.error);
        return true;
      }
    } else {
      self.loggedIn.dispatch();
      self.status('loggedIn');
    }
  });
}
LoginViewModel.prototype.template = 'login';
