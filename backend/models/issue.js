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


var mongoose = require('mongoose');
var ModelFactory = require('./factory/modelFactory');
var Schema = mongoose.Schema;
var ProjectSetting = require('./projectSetting');
var utils = require('../utils');
var stringToUUID = utils.stringToUUID;
var uuidToString = utils.uuidToString;
var History = require('./history');
var Ref = require('./ref');
var GenericObject = require('./base/repo').GenericObject;
var uuid = require("node-uuid");
var responseCodes = require('../response_codes.js');
var middlewares = require('../routes/middlewares');
var xmlBuilder = require('xmlbuilder');
var moment = require('moment');
var archiver = require('archiver');

var schema = Schema({
	_id: Object,
	object_id: Object,
	rev_id: Object,
	name: { type: String, required: true },
	viewpoint: {
		up: [Number],
		position: [Number],
		look_at: [Number],
		view_dir: [Number],
		right: [Number],
		unityHeight : Number,
		fov : Number,
		aspect_ratio: Number,
		far : Number,
		near : Number,
		clippingPlanes : [Schema.Types.Mixed ]

	},

	scale: Number,
	position: [Number],
	norm: [Number],
	created: Number,
	parent: Object,
	number: Number,
	owner: String,
	closed: Boolean,
	priority: String,
	comments: [{
		owner: String,
		comment: {type: String, required: true},
		created: Number,
		//TO-DO Error: `set` may not be used as a schema pathname
		//set: Boolean
		sealed: Boolean,
		rev_id: Object
	}],
	assigned_roles: [Schema.Types.Mixed],
	closed_time: Number,
	creator_role: String,
	scribble: Object,
	screenshot: Object,
});


// Model statics method
//internal helper _find
schema.statics._find = function(dbColOptions, filter, projection, noClean){
	'use strict';
	//get project type
	let settings;
	let issues;

	return ProjectSetting.findById(dbColOptions, dbColOptions.project).then(_settings => {
		settings = _settings;
		return this.find(dbColOptions, filter, projection);
	}).then(_issues => {

		issues = _issues;
		issues.forEach((issue, index) => {
			issues[index] = noClean ? issue: issue.clean(settings.type);
		});

		return Promise.resolve(issues);
	});
};

schema.statics.getFederatedProjectList = function(dbColOptions, username, branch, revision){
	'use strict';

	var allRefs = [];

	function _get(dbColOptions, branch, revision){

		let getHistory;

		if(branch){
			getHistory = History.findByBranch(dbColOptions, branch);
		} else if (revision) {
			getHistory = utils.isUUID(revision) ? History.findByUID(dbColOptions, revision) : History.findByTag(dbColOptions, revision);
		}

		return getHistory.then(history => {


			if(!history){
				return Promise.resolve([]);
			}

			let filter = {
				type: "ref",
				_id: { $in: history.current }
			};


			return Ref.find(dbColOptions, filter);

		}).then(refs => {

			var promises = [];

			refs.forEach(ref => {
				var childDbName  = ref.owner ? ref.owner : dbColOptions.account;
				var childProject = ref.project;

				var unique = ref.unique;

				var childRevision, childBranch;
				if (ref._rid){
					if (unique){
						childRevision = uuidToString(ref._rid);
					} else {
						childBranch   = uuidToString(ref._rid);
					}
				} else {
					childBranch   = "master";
				}

				let dbCol = {
					account: childDbName,
					project: childProject
				};

				promises.push(_get(dbCol, childBranch, childRevision));

			});

			//console.log('some refs', refs)
			allRefs = allRefs.concat(refs);

			return Promise.all(promises);

		});
	}


	return _get(dbColOptions, branch, revision).then(() => {
		return Promise.resolve(allRefs);
	});

};


schema.statics.findByProjectName = function(dbColOptions, username, branch, revId, projection, noClean){

	'use strict';
	let issues;
	let self = this;
	let filter = {};

	let addRevFilter = Promise.resolve();

	if (revId){

		let findHistory = utils.isUUID(revId) ? History.findByUID : History.findByTag;
		let currHistory;
		addRevFilter = findHistory(dbColOptions, revId).then(history => {

			if(!history){
				return Promise.reject(responseCodes.PROJECT_HISTORY_NOT_FOUND);
			} else {

				currHistory = history;

				return History.find(
					dbColOptions, 
					{ timestamp: {'$gt': currHistory.timestamp }}, 
					{_id : 1, timestamp: 1}, 
					{sort: {timestamp: 1}}
				);

			}

		}).then(histories => {

			if(histories.length > 0){

				let history = histories[0];
				console.log('next history found', history);

				//backward comp: find all issues, without rev_id field, with timestamp just less than the next cloest revision 
				filter = {
					'created' : { '$lt': history.timestamp.valueOf() },
					rev_id: null 
				};
			}

			return History.find(
				dbColOptions, 
				{ timestamp: {'$lte': currHistory.timestamp }}, 
				{_id : 1}
			);
		}).then(histories => {

			if(histories.length > 0){
				// for issues with rev_id, get all issues if rev_id in revIds
				let revIds = histories.map(h => h._id);

				filter = {
					'$or' : [ filter, {
						rev_id: { '$in' : revIds }
					}]
				};
				//console.log(filter);

			}
		});
	}


	return addRevFilter.then(() => {
		return this._find(dbColOptions, filter, projection || {screenshot: 0}, noClean);
	}).then(_issues => {
		issues = _issues;
		return self.getFederatedProjectList(
			dbColOptions,
			username,
			branch,
			revId
		);

	}).then(refs => {

		if(!refs.length){
			return Promise.resolve(issues);
		} else {

			let promises = [];
			refs.forEach(ref => {
				let childDbName = ref.owner || dbColOptions.account;
				let childProject = ref.project;

				promises.push(
					middlewares.hasReadAccessToProjectHelper(username, childDbName, childProject).then(granted => {
						if(granted){
							return self._find({account: childDbName, project: childProject}, null, projection || {screenshot: 0}, noClean);
						} else {
							return Promise.resolve([]);
						}
					})
				);
			});

			return Promise.all(promises).then(refIssues => {
				refIssues.forEach(refIssue => {
					issues = issues.concat(refIssue);
				});

				return Promise.resolve(issues);
			});
		}
	});

};

schema.statics.getBCFZipReadStream = function(account, project, username, branch, revId){
	'use strict';

	var zip = archiver.create('zip');

	zip.append(new Buffer(this.getProjectBCF(project), 'utf8'), {name: 'project.bcf'})
	.append(new Buffer(this.getBCFVersion(), 'utf8'), {name: 'bcf.version'})

	let projection = {};
	let noClean = true;

	return this.findByProjectName({account, project}, username, branch, revId, projection, noClean).then(issues => {

		issues.forEach(issue => {

			zip.append(new Buffer(issue.getBCFMarkup(), 'utf8'), {name: `${uuidToString(issue._id)}/markup.bcf`})
			.append(new Buffer(issue.getBCFViewpoint(), 'utf8'), {name: `${uuidToString(issue._id)}/viewpoint.bcfv`})

			if(issue.screenshot){
				zip.append(issue.screenshot.buffer, {name: `${uuidToString(issue._id)}/snapshot.png`});
			}
		});

		zip.finalize();

		return Promise.resolve(zip);
	});

}

schema.statics.findBySharedId = function(dbColOptions, sid, number) {
	'use strict';

	let filter = { parent: stringToUUID(sid) };

	if(number){
		filter.number = number;
	}

	return this._find(dbColOptions, filter).then(issues => {
		issues.forEach((issue, i) => {
			if(issue.scribble){
				issues[i] = issue.scribble.toString('base64');
			}
		});

		return Promise.resolve(issues);
	});
};

schema.statics.findByUID = function(dbColOptions, uid, onlyStubs, noClean){
	'use strict';

	let projection = {};

	if (onlyStubs){
		projection = {
			_id : 1,
			name : 1,
			deadline : 1,
			position: 1,
			parent: 1
		};
	}

	return this.findById(dbColOptions, stringToUUID(uid)).then(issue => {
		return Promise.resolve(noClean ? issue : issue.clean());
	});
};

schema.statics.createIssue = function(dbColOptions, data){
	'use strict';

	let objectId = data.object_id;

	let promises = [];

	let issue = Issue.createInstance(dbColOptions);
 	issue._id = stringToUUID(uuid.v1());

 	if(!data.name){
 		return Promise.reject({ resCode: responseCodes.ISSUE_NO_NAME });
 	}

	if(objectId){
		promises.push(
			GenericObject.getSharedId(dbColOptions, objectId).then(sid => {
				issue.parent = stringToUUID(sid);
			})
		);
	}

	let getHistory;

	if(data.revId){
		getHistory = utils.isUUID(data.revId) ? History.findByUID : History.findByTag;
		getHistory = getHistory(dbColOptions, data.revId, {_id: 1});
	} else {
		getHistory = History.findByBranch(dbColOptions, 'master', {_id: 1});
	}

	//assign rev_id for issue
	promises.push(getHistory.then(history => {
		if(!history && data.revId){
			return Promise.reject(responseCodes.PROJECT_HISTORY_NOT_FOUND);
		} else if (history){
			issue.rev_id = history._id;
		}
	}));

	return Promise.all(promises).then(() => {
		return Issue.count(dbColOptions);
		
	}).then(count => {

		issue.number  = count + 1;
		issue.object_id = objectId && stringToUUID(objectId);
		issue.name = data.name;
		issue.created = (new Date()).getTime();
		issue.owner = data.owner;
		issue.scribble = data.scribble && new Buffer(data.scribble, 'base64');
		issue.screenshot = data.screenshot && new Buffer(data.screenshot, 'base64');
		issue.viewpoint = data.viewpoint;
		issue.scale = data.scale;
		issue.position = data.position;
		issue.norm = data.norm;
		issue.creator_role = data.creator_role;
		issue.assigned_roles = data.assigned_roles;

		return issue.save().then(() => {
			return ProjectSetting.findById(dbColOptions, dbColOptions.project);
		}).then(settings => {
			issue.screenshot = 'saved';
			return Promise.resolve(issue.clean(settings.type));
		});

	});

};

schema.methods.updateComment = function(commentIndex, data){
	'use strict';
	let timeStamp = (new Date()).getTime();

	if(this.closed || (this.comments[commentIndex] && this.comments[commentIndex].sealed)){
		return Promise.reject({ resCode: responseCodes.ISSUE_COMMENT_SEALED });
	}

	if(commentIndex === null || typeof commentIndex === 'undefined'){

		let getHistory;

		if(data.revId){
			getHistory = utils.isUUID(data.revId) ? History.findByUID : History.findByTag;
			getHistory = getHistory(this._dbcolOptions, data.revId, {_id: 1});
		} else {
			getHistory = History.findByBranch(this._dbcolOptions, 'master', {_id: 1});
		}

		//assign rev_id for issue
		return getHistory.then(history => {
			if(!history && data.revId){
				return Promise.reject(responseCodes.PROJECT_HISTORY_NOT_FOUND);
			} else {

				this.comments.push({ 
					owner: data.owner,	
					comment: data.comment, 
					created: timeStamp,
					rev_id: history ? history._id : undefined
				});
			}
		}).then(() => {
			return this.save();
		});


	} else {

		let commentObj = this.comments[commentIndex];
		
		if(!commentObj){
			return Promise.reject({ resCode: responseCodes.ISSUE_COMMENT_INVALID_INDEX });
		}

		if(commentObj.owner !== data.owner && data.comment){
			return Promise.reject({ resCode: responseCodes.ISSUE_COMMENT_PERMISSION_DECLINED });
		}

		if(data.comment){
			commentObj.comment = data.comment;
			commentObj.created = timeStamp;
		}
		
		commentObj.sealed = data.sealed || commentObj.sealed;

		return this.save();
	}

	
};

schema.methods.removeComment = function(commentIndex, data){
	'use strict';

	let commentObj = this.comments[commentIndex];
	
	if(!commentObj){
		return Promise.reject({ resCode: responseCodes.ISSUE_COMMENT_INVALID_INDEX });
	}

	if(commentObj.owner !== data.owner){
		return Promise.reject({ resCode: responseCodes.ISSUE_COMMENT_PERMISSION_DECLINED });
	}

	if(this.closed || this.comments[commentIndex].sealed){
		return Promise.reject({ resCode: responseCodes.ISSUE_COMMENT_SEALED });
	}

	this.comments[commentIndex].remove();
	return this.save();
};

schema.methods.closeIssue = function(){
	'use strict';

	if(this.closed){
		return Promise.reject({ resCode: responseCodes.ISSUE_CLOSED_ALREADY });
	}

	this.closed = true;
	this.closed_time = (new Date()).getTime();
	return this.save();
};

schema.methods.reopenIssue = function(){
	'use strict';

	this.closed = false;
	this.closed_time = null;
	return this.save();
};

//Model method
schema.methods.clean = function(typePrefix){
	'use strict';

	let cleaned = this.toObject();
	cleaned._id = uuidToString(cleaned._id);
	cleaned.typePrefix = typePrefix;
	cleaned.parent = cleaned.parent ? uuidToString(cleaned.parent) : undefined;
	cleaned.account = this._dbcolOptions.account;
	cleaned.project = this._dbcolOptions.project;
	cleaned.rev_id && (cleaned.rev_id = uuidToString(cleaned.rev_id));

	cleaned.comments.forEach( (comment, i) => {
		cleaned.comments[i].rev_id = comment.rev_id && (comment.rev_id = uuidToString(comment.rev_id));
	});

	if(cleaned.scribble){
		cleaned.scribble = cleaned.scribble.toString('base64');
	}


	if(cleaned.screenshot){
		cleaned.screenshot = cleaned.screenshot.toString('base64');
	}

	return cleaned;
};

schema.methods.getBCFMarkup = function(){
	'use strict';

	let markup = {
		Markup:{
			'@xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
			'@xmlns:xsd': 'http://www.w3.org/2001/XMLSchema',
			Header:{},
			Topic: {
				'@Guid': uuidToString(this._id),
				'@TopicStatus': this.closed ? 'Closed' : 'Open',
				'Priority': this.priority,
				'Title': this.name ,
				'CreationDate': moment(this.created).utc().format() ,
				'CreationAuthor': this.owner 
			}
		}
	};

	let markupXml = xmlBuilder.create(markup, {version: '1.0', encoding: 'UTF-8'});

	let viewPointGuid = uuidToString(utils.generateUUID());
	
	if(this.comments.length > 0){
		let vpNode = markupXml.ele('Viewpoints', { 'Guid': viewPointGuid });
		vpNode.ele('Viewpoint', 'viewpoint.bcfv');
		if(this.screenshot){
			vpNode.ele('Snapshot', 'snapshot.png');
		}
	}

	this.comments.forEach(comment => {
		let commentNode = markupXml.ele('Comment', { 'Guid': uuidToString(utils.generateUUID()) });
		commentNode.ele('Comment', comment.comment);
		commentNode.ele('Author', comment.owner);
		commentNode.ele('Date', moment(comment.created).utc().format());
		commentNode.ele('Viewpoint', { 'Guid': viewPointGuid });
	});



	return markupXml.end({ pretty: true });
};

schema.statics.getBCFVersion = function(){
	'use strict';

	return `
		<?xml version="1.0" encoding="UTF-8"?>
		<Version VersionId="2.0" xsi:noNamespaceSchemaLocation="version.xsd" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
			<DetailedVersion>2.0 RC</DetailedVersion>
		</Version>
	`;

}

schema.statics.getProjectBCF = function(projectId){
	'use strict';

	let project = {
		ProjectExtension:{
			'@xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
			'@xmlns:xsd': 'http://www.w3.org/2001/XMLSchema',
			Project: {
				'@ProjectId': projectId,
				'Name': projectId,
			},
			'ExtensionSchema': {

			}
		}
	};

	return xmlBuilder.create(project, {version: '1.0', encoding: 'UTF-8'}).end({ pretty: true });
}

schema.methods.getBCFViewpoint = function(){
	'use strict';

	let viewpoint = {
		VisualizationInfo:{
			'@xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
			'@xmlns:xsd': 'http://www.w3.org/2001/XMLSchema',
			PerspectiveCamera:{
				CameraViewPoint:{
					X: this.viewpoint.position[0],
					Y: this.viewpoint.position[1],
					Z: this.viewpoint.position[2]
				},
				CameraDirection:{
					X: this.viewpoint.view_dir[0],
					Y: this.viewpoint.view_dir[1],
					Z: this.viewpoint.view_dir[2]
				},
				CameraUpVector:{
					X: this.viewpoint.up[0],
					Y: this.viewpoint.up[1],
					Z: this.viewpoint.up[2]
				},
				FieldOfView: this.viewpoint.fov
			}
		}

	};

	let viewpointXml =  xmlBuilder.create(viewpoint, {version: '1.0', encoding: 'UTF-8'});

	return viewpointXml.end({ pretty: true });
};


var Issue = ModelFactory.createClass(
	'Issue',
	schema,
	arg => {
		return `${arg.project}.issues`;
	}
);

module.exports = Issue;
