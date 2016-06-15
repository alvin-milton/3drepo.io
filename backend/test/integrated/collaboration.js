'use strict';

/**
 *  Copyright (C) 2014 3D Repo Ltd
 *
 *  This program is free software: you can redistribute it and/or modify
 *  it under the terms of the GNU Affero General Public License as
 *  published by the Free Software Foundation, either version 3 of the
 *  License, or (at your option) any later version.
 *
 *  This program is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU Affero General Public License for more details.
 *
 *  You should have received a copy of the GNU Affero General Public License
 *  along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

let request = require('supertest');
let expect = require('chai').expect;
let app = require("../../services/api.js").createApp(
	{ session: require('express-session')({ secret: 'testing'}) }
);
let log_iface = require("../../logger.js");
let systemLogger = log_iface.systemLogger;
let responseCodes = require("../../response_codes.js");
let helpers = require("./helpers");
let async = require('async');

describe('Sharing a project', function () {
	let User = require('../../models/user');
	let server;
	let agent;
	let username = 'testing';
	let password = 'testing';
	let project = 'testproject';
	let email = suf => `test3drepo_collaboration_${suf}@mailinator.com`;


	let username_viewer = 'collaborator_viewer';
	let password_viewer = 'collaborator_viewer';

	let username_editor = 'collaborator_editor';
	let password_editor = 'collaborator_editor';

	before(function(done){

		server = app.listen(8080, function () {
			console.log('API test server is listening on port 8080!');


			async.series([
				function createViewer(done){
					helpers.signUpAndLogin({
						server, request, agent, expect, User, systemLogger,
						username: username_viewer, password: password_viewer, email: email('viewer'),
						done
					});
				},
				function createEditor(done){
					helpers.signUpAndLogin({
						server, request, agent, expect, User, systemLogger,
						username: username_editor, password: password_editor, email: email('editor'),
						done
					});
				}
			], done);
		});

	});

	after(function(done){
		server.close(function(){
			console.log('API test server is closed');
			done();
		});
	});


	describe('for view only', function(){

		before(function(done){

			agent = request.agent(server);
			agent.post('/login')
			.send({ username, password })
			.expect(200, function(err, res){
				expect(res.body.username).to.equal(username);
				done(err);
			});
			
		});

		after(function(done){

			agent.post('/logout')
			.send({})
			.expect(200, done);
		});

		it('should succee and the viewer is able to see the project', function(done){
			let role = {
				user: username_viewer,
				role: 'viewer'
			};

			async.series([
				function share(done){

					agent.post(`/${username}/${project}/collaborators`)
					.send(role)
					.expect(200, function(err, res){
						expect(res.body).to.deep.equal(role);
						done(err);
					});
				},
				function logout(done){

					agent.post('/logout')
					.send({})
					.expect(200, function(err, res){
						expect(res.body.username).to.equal(username);
						done(err);
					});
				},
				function loginAsViewer(done){

					agent.post('/login')
					.send({ username: username_viewer, password: password_viewer })
					.expect(200, function(err, res){
						expect(res.body.username).to.equal(username_viewer);
						done(err);
					});
				},
				function checkSharedProjectInList(done){

					agent.get(`/${username_viewer}.json`)
					.expect(200, function(err, res){

						expect(res.body).to.have.property('accounts').that.is.an('array');
						let account = res.body.accounts.find( a => a.account === username);
						expect(account).to.have.property('projects').that.is.an('array');
						let projectObj = account.projects.find( p => p.project === project);
						expect(projectObj).to.have.property('project', project);

						done(err);
					});
				},
				function ableToViewProject(done){

					agent.get(`/${username}/${project}/revision/master/head.x3d.mp`)
					.expect(200, function(err ,res){
						done(err);
					});
				}
			], done);


		});


		it('and the viewer should be able to see list of issues', function(done){
			agent.get(`/${username}/${project}/issues.json`)
			.expect(200, done);
		});

		it('and the viewer should NOT be able to see raise issue', function(done){
			agent.post(`/${username}/${project}/issues.json`)
			.send({ data: {} })
			.expect(401 , done);
		});

		describe('and then remove the role', function(done){
			before(function(done){
				async.waterfall([
					function logout(done){

						agent.post('/logout')
						.send({})
						.expect(200, function(err, res){
							expect(res.body.username).to.equal(username_viewer);
							done(err);
						});
					},
					function loginAsProjectOwner(done){

						agent.post('/login')
						.send({ username, password })
						.expect(200, function(err, res){
							expect(res.body.username).to.equal(username);
							done(err);
						});
					}
				], done);
			});

			it('should succee and the viewer is NOT able to see the project', function(done){

				let role = {
					user: username_viewer,
					role: 'viewer'
				};
					
				async.waterfall([
					function remove(done){

						agent.delete(`/${username}/${project}/collaborators`)
						.send(role)
						.expect(200, function(err, res){
							expect(res.body).to.deep.equal(role);
							done(err);
						});
					},
					function logout(done){

						agent.post('/logout')
						.send({})
						.expect(200, function(err, res){
							expect(res.body.username).to.equal(username);
							done(err);
						});
					},
					function loginAsViewer(done){

						agent.post('/login')
						.send({ username: username_viewer, password: password_viewer })
						.expect(200, function(err, res){
							expect(res.body.username).to.equal(username_viewer);
							done(err);
						});
					},
					function checkSharedProjectInList(done){

						agent.get(`/${username_viewer}.json`)
						.expect(200, function(err, res){

							expect(res.body).to.have.property('accounts').that.is.an('array');
							let account = res.body.accounts.find( a => a.account === username);
							expect(account).to.be.undefined;

							done(err);
						});
					},
					function notAbleToViewProject(done){

						agent.get(`/${username}/${project}/revision/master/head.x3d.mp`)
						.expect(401, function(err ,res){
							done(err);
						});
					}
				], done);

			});

			it('and the viewer should NOT be able to see raise issue', function(done){
				agent.post(`/${username}/${project}/issues.json`)
				.send({ data: {} })
				.expect(401 , done);
			});
		});
	});

	describe('for both view and edit', function(){
		before(function(done){

			agent = request.agent(server);
			agent.post('/login')
			.send({ username, password })
			.expect(200, function(err, res){
				expect(res.body.username).to.equal(username);
				done(err);
			});
			
		});

		after(function(done){

			agent.post('/logout')
			.send({})
			.expect(200, done);
		});

		it('should succee and the editor is able to see the project', function(done){
			let role = {
				email: email('editor'),
				role: 'collaborator'
			};

			async.series([
				function share(done){

					agent.post(`/${username}/${project}/collaborators`)
					.send(role)
					.expect(200, function(err, res){
						expect(res.body).to.deep.equal(role);
						done(err);
					});
				},
				function logout(done){

					agent.post('/logout')
					.send({})
					.expect(200, function(err, res){
						expect(res.body.username).to.equal(username);
						done(err);
					});
				},
				function loginAsEditor(done){

					agent.post('/login')
					.send({ username: username_editor, password: password_editor })
					.expect(200, function(err, res){
						expect(res.body.username).to.equal(username_editor);
						done(err);
					});
				},
				function checkSharedProjectInList(done){

					agent.get(`/${username_editor}.json`)
					.expect(200, function(err, res){

						expect(res.body).to.have.property('accounts').that.is.an('array');
						let account = res.body.accounts.find( a => a.account === username);
						expect(account).to.have.property('projects').that.is.an('array');
						let projectObj = account.projects.find( p => p.project === project);
						expect(projectObj).to.have.property('project', project);

						done(err);
					});
				},
				function ableToViewProject(done){

					agent.get(`/${username}/${project}/revision/master/head.x3d.mp`)
					.expect(200, function(err ,res){
						done(err);
					});
				}
			], done);


		});


		it('and the editor should be able to see list of issues', function(done){
			agent.get(`/${username}/${project}/issues.json`)
			.expect(200, done);
		});

		it('and the editor should be able to raise issue', function(done){

			let issue = { 
				"name": "issue",
				"viewpoint":{
					"up":[0,1,0],
					"position":[38,38 ,125.08011914810137],
					"look_at":[0,0,-163.08011914810137],
					"view_dir":[0,0,-1],
					"right":[1,0,0],
					"unityHeight ":3.537606904422707,
					"fov":2.1124830653010416,
					"aspect_ratio":0.8750189337327384,
					"far":276.75612077194506 ,
					"near":76.42411012233212,
					"clippingPlanes":[]
				},
				"scale":1,
				"creator_role":"testproject.collaborator",
				"assigned_roles":["testproject.collaborator"],
			};

			agent.post(`/${username}/${project}/issues.json`)
			.send({ data: JSON.stringify(issue) })
			.expect(200 , done);
		});

		describe('and then remove the role', function(done){
			before(function(done){
				async.waterfall([
					function logout(done){

						agent.post('/logout')
						.send({})
						.expect(200, function(err, res){
							expect(res.body.username).to.equal(username_editor);
							done(err);
						});
					},
					function loginAsProjectOwner(done){

						agent.post('/login')
						.send({ username, password })
						.expect(200, function(err, res){
							expect(res.body.username).to.equal(username);
							done(err);
						});
					}
				], done);
			});

			it('should succee and the editor is NOT able to see the project', function(done){

				let role = {
					user: username_editor,
					role: 'collaborator'
				};
					
				async.waterfall([
					function remove(done){

						agent.delete(`/${username}/${project}/collaborators`)
						.send(role)
						.expect(200, function(err, res){
							expect(res.body).to.deep.equal(role);
							done(err);
						});
					},
					function logout(done){

						agent.post('/logout')
						.send({})
						.expect(200, function(err, res){
							expect(res.body.username).to.equal(username);
							done(err);
						});
					},
					function loginAsEditor(done){

						agent.post('/login')
						.send({ username: username_editor, password: password_editor })
						.expect(200, function(err, res){
							expect(res.body.username).to.equal(username_editor);
							done(err);
						});
					},
					function checkSharedProjectInList(done){

						agent.get(`/${username_editor}.json`)
						.expect(200, function(err, res){

							expect(res.body).to.have.property('accounts').that.is.an('array');
							let account = res.body.accounts.find( a => a.account === username);
							expect(account).to.be.undefined;

							done(err);
						});
					},
					function notAbleToViewProject(done){

						agent.get(`/${username}/${project}/revision/master/head.x3d.mp`)
						.expect(401, function(err ,res){
							done(err);
						});
					}
				], done);

			});

			it('and the editor should NOT be able to raise issue', function(done){
				agent.post(`/${username}/${project}/issues.json`)
				.send({ data: {} })
				.expect(401 , done);
			});
		});
	});
});