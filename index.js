var MailListener = require("mail-listener2");
var MailHops = require("mailhops");
var Slack = require('slack-node');
var chalk = require('chalk');
var notifier = require('node-notifier');
var logUpdate = require('log-update');
var _ = require('lodash');
var config = require('./config.json');
var pkg = require('./package.json');

var configuration = {
  username: "", // imap username
  password: "", // imap password
  host: "", // imap host
  port: 993, // imap port
  tls: true,
  notify: true,
  connTimeout: 10000, // Default by node-imap
  authTimeout: 5000, // Default by node-imap,
  debug: console.log, // Or your custom function with only one incoming argument. Default: null
  tlsOptions: { rejectUnauthorized: false },
  mailbox: "INBOX", // mailbox to monitor
  searchFilter: ["UNSEEN"], // the search filter being used after an IDLE notification has been retrieved
  markSeen: false, // all fetched email willbe marked as seen and not fetched next time
  fetchUnreadOnStart: true, // use it only if you want to get all unread email on lib start. Default is `false`,
  mailParserOptions: {streamAttachments: true}, // options to be passed to mailParser lib.
  attachments: false, // download attachments as they are encountered to the project directory
  attachmentOptions: { directory: "attachments/" } // specify a download directory for attachments
};

var mhconfiguration = {
    api_key: "",
    api_version: 2,
    app_name: pkg.name+'-'+pkg.version
};

if(config){
  configuration = _.merge(configuration,config);
}

if(config && config.mailhops){
  mhconfiguration = _.merge(mhconfiguration,config.mailhops);
}

var mailListener = new MailListener(configuration);

var mailhops = new MailHops(mhconfiguration);

var slack;
// setup Slack
if(config && config.slack){
  slack = new Slack();
  slack.setWebhook(config.slack.webhookUri);
}

mailListener.start(); // start listening

// stop listening
//mailListener.stop();

mailListener.on("server:connected", function(){
  console.log("imapConnected");
});

mailListener.on("server:disconnected", function(){
  console.log("imapDisconnected");
});

mailListener.on("error", function(err){
  console.log(err);
});

mailListener.on("mail", function(mail, seqno, attributes){
  // do something with mail object including attachments
  // mail processing code goes here
  var ips = mailhops.getIPsFromMailParser(mail);
  if(ips){
    mailhops.lookup(ips,function(err, res, body){
      if(err) return logUpdate(`${chalk.red('MailHops Error: '+err)}`);
      if(body.error && body.error.message) return logUpdate(`${chalk.red('MailHops Error: '+body.error.message)}`);

      mail.mailHops = body.response;
      if(typeof mail.mailHops != 'undefined'){

        let start = mailhops.getStartHop(mail.mailHops.route);
        let end = mailhops.getEndHop(mail.mailHops.route);

        logUpdate(`${chalk.bold(mail.from[0].name+' '+mail.from[0].address)}`);
        logUpdate.done();

        logUpdate(`${chalk.green( start.city+', '+start.state+' ('+start.countryCode+')' )} -> ${chalk.red( end.city+', '+end.state+' ('+end.countryCode+')')} ${chalk.yellow(Math.round(mail.mailHops.distance.miles)+' mi.')}
        `);
        logUpdate.done();

        // notify
        if(configuration.notify){
          notifier.notify({
            'title': 'New mail from '+mail.from[0].name,
            'subtitle': start.city+', '+start.state+' ('+start.countryCode+') '+Math.round(mail.mailHops.distance.miles)+' mi.',
            'icon': start.flag,
            'message': mail.subject,
            'sound': true,
            'time': 5000
          });
        }

        let slackit = false;
        // slack
        if(slack){
          // check slack filters
          if(!!configuration.slack.fromAddress){
            if(mail.from[0].address.toLowerCase().indexOf(configuration.slack.fromAddress.toLowerCase()) !== -1){
              slackit = true;
            }
          } else if(!!configuration.slack.subjectFilter){
            if(mail.subject.toLowerCase().indexOf(configuration.slack.subjectFilter.toLowerCase()) !== -1){
              slackit = true;
            }
          } else { // no filters
            slackit = true;
          }
          if(slackit){
            slack.webhook({
              channel: configuration.slack.channel,
              username: "MailHopsBot",
              text: 'New mail from '+mail.from[0].name+' '+mail.from[0].address,
              attachments: [{
                    title: 'MailHops route from '+start.city+', '+start.state+' ('+start.countryCode+') '+Math.round(mail.mailHops.distance.miles)+' mi.',
                    title_link: mailhops.mapUrl(ips),
                    text: mail.text
                  }
              ],
              icon_emoji: "https://www.mailhops.com/images/mailhops-64.png"
            }, function(err, response) {
              if(err) console.log('Slack Error',err);
            });
          }
        }
      }
    });
  }
});

mailListener.on("attachment", function(attachment){
  console.log(attachment.path);
});
