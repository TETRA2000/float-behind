"use strict";

const getUrls = require("get-urls");
const axios = require("axios");
const _ = require("lodash");
const Promise = require("bluebird");
const moment = require("moment");
const textUtil = require("../utils/text");
const SlackApi = require("../utils/slack-api");

const Page = require("../db/page");
const User = require("../db/user");
const Group = require("../db/group");

exports.getOAuthUrl = function () {
  return SlackApi.oauthUrl;
};

exports.fetchTokenByParam = function (redirectParam) {
  const api = new SlackApi();
  return api.oauthAccess(redirectParam.code)
    .then((data) => data.accessToken);
};

exports.saveSlackUser = function(token) {
  const api = new SlackApi(token);

  return api.authTest()
    .then((data) => {
      return Promise.all([
        User.createFromSlack(data.userId, data.teamId, token),
        api.usersInfo(data.userId)
      ]);
    })
    .then((values) => {
      const user = values[0];
      const slackUser = values[1].user;

      return user.set({
        name: slackUser.name,
        email: slackUser.profile.email,
        iconUrl: slackUser.profile.image48
      }).save();
    })
    .catch((err) => console.error(err));
};

exports.createPageByCommand = function (commandParam) {

  const param = SlackApi.snakeToCamel(commandParam);
  const pageUrl = _.first(getUrls(param.text));

  // There is no url in text
  if (!pageUrl) {
    return Promise.resolve(null);
  }

  // get the title from the page
  const titlePromise = axios.get(pageUrl)
    .then((response) => textUtil.extractTitleFromHtml(response.data));

  // create the user for the command author if not exists
  const userPromise = User.where("slack_user_id", "=", param.userId)
    .fetch()
    .then((user) => {
      if (user) return Promise.resolve(user);

      const newUser = new User({
        slackUserId: param.userId,
        name: param.userName
      });

      return newUser.save();
    });

  // create a group having the posted page if not exists
  const groupPromise = Group.where("slack_team_id", "=", param.teamId)
    .fetch({ withRelated: "users" })
    .then((group) => {
      if (group) return Promise.resolve(group);

      const newGroup = new Group({
        slackTeamId: param.teamId
      });

      return newGroup.save();
    });

  // save and return the new page
  return Promise.all([titlePromise, userPromise, groupPromise])
    .then((values) => {
      const title = values[0];
      const user = values[1];
      const group = values[2];

      const page = new Page({
        userId: user.get("id"),
        groupId: group.get("id"),
        from: "Slack",
        datetime:  moment().toDate(),
        url: pageUrl,
        title: title
      });

      return page.save()
        .tap((page) => {
          return page.floatFor(group.related("users"));
        });
    });
};
