/**
 *	Copyright (C) 2016 3D Repo Ltd
 *
 *	This program is free software: you can redistribute it and/or modify
 *	it under the terms of the GNU Affero General Public License as
 *	published by the Free Software Foundation, either version 3 of the
 *	License, or (at your option) any later version.
 *
 *	This program is distributed in the hope that it will be useful,
 *	but WITHOUT ANY WARRANTY; without even the implied warranty of
 *	MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *	GNU Affero General Public License for more details.
 *
 *	You should have received a copy of the GNU Affero General Public License
 *	along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

(function () {
	"use strict";

	angular.module("3drepo")
		.directive("accountCollaborators", accountCollaborators);

	function accountCollaborators() {
		return {
			restrict: 'EA',
			templateUrl: 'accountCollaborators.html',
			scope: {
				showPage: "&"
			},
			controller: AccountCollaboratorsCtrl,
			controllerAs: 'vm',
			bindToController: true
		};
	}

	AccountCollaboratorsCtrl.$inject = ["$scope"];

	function AccountCollaboratorsCtrl($scope) {
		var vm = this;

		/*
		 * Init
		 */
		vm.users = [
			{name: "carmenfan"},
			{name: "henryliu"}
		];
		vm.collaborators = [
			{name: "jozefdobos"},
			{name: "timscully"}
		];
		vm.unassigned = [];
		vm.numUnassigned = 2;

		$scope.$watch("vm.numUnassigned", function () {
			// This might not be the best way of modifying unassigned but it's neat :-)
			delete vm.unassigned;
			vm.unassigned = new Array(vm.numUnassigned);

			vm.addDisabled = (vm.numUnassigned === 0);
		});

		/**
		 * Add the selected user as a collaborator
		 */
		vm.addCollaborator = function () {
			var i, length;
			if (vm.selectedUser !== null) {
				vm.collaborators.push(vm.selectedUser);
				for (i = 0, length = vm.users.length; i < length; i += 1) {
					if (vm.users[i].name === vm.selectedUser.name) {
						vm.users.splice(i, 1);
						break;
					}
				}
				vm.searchText = null;
				vm.numUnassigned -= 1;
			}
		};

		/**
		 * Remove a collaborator
		 *
		 * @param index
		 */
		vm.removeCollaborator = function (index) {
			var collaborator = vm.collaborators.splice(index, 1);
			vm.users.push(collaborator[0]);
			vm.numUnassigned += 1;
		};

		vm.querySearch = function (query) {
			return query ? vm.users.filter(createFilterFor(query)) : vm.users;
		};

		function createFilterFor (query) {
			var lowercaseQuery = angular.lowercase(query);
			return function filterFn(user) {
				return (user.name.indexOf(lowercaseQuery) === 0);
			};
		}
	}
}());