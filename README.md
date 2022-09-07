# S01E01

Code samples and other resources from the Build on [AWS Open Source episode, S01E01](https://www.youtube.com/watch?v=yvaOErf6hcA). This episode featured the AWS open source newsletters [124](https://dev.to/aws/aws-open-source-news-and-updates-124-1i17) and [123](https://dev.to/aws/aws-open-source-news-and-updates-123-6o3)


**DevSecOps Demo**

Some additional notes on this project. I have modified the original cdk app to add an IAM user as admin for the EKS cluster. In the code that IAM user is called "ops" you can remove these two lines or change it for the user you use. This way you will see resources in the console. The CDK deploy will likely fail if you do not update this.

1. Make sure you have CDK and Typescript running in your local dev environment. You will need to also install ```npm i aws-cdk-lib```
2. Before you build the stack, make sure you have updated the VPC info. I created a new vpc using cdk to do this
3. Create in AWS secrets two secrets (dockerhub and dockerhubtwo) which contain a key of username (dockerhub) and password (dockerhubtwo) with valid credentials for Docker
4. In the Kubernetes/deployment.yaml update the link to the container image once it has been built

To test its working use the following command:

```
kubectl port-forward {pod} 8080:8080
```

**Xray CLI Demo**

Some notes on the pre-requisites for https://github.com/mhlabs/xray-cli:

1. Make sure you have the AWS CLI installed and configured https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html
2. If you dont currently trace using AWS X-RAY, but want to get a feel for it and to generate test data - recommend having a look at https://serverless-observability.workshop.aws/ 

After doing these and running ``` npm install -g @mhlabs/xray-cli ```   you will then be able to run ``` xray traces ``` and play with some rather nifty ascii art :)

**Flutter Auth Demo

Please refer to this blog https://aws.amazon.com/blogs/mobile/amplify-flutter-auth-web-and-desktop/: for the prerequisites needed to run this flutter application

Notes: 
1. You will need to install the Amplify CLI and Configure Flutter Development environment
2.  If you are on a Mac ARM laptop you will need to setup cocoa pods to use arm 
```
sudo gem uninstall ffi && sudo gem install ffi -- --enable-libffi-alloc
```
3. This project has NOT been tested in Android or other desktops beyond MacOS

