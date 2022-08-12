import 'dart:io';

import 'package:amplify_auth_cognito/amplify_auth_cognito.dart';
import 'package:amplify_authenticator/amplify_authenticator.dart';
import 'package:amplify_flutter/amplify_flutter.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import 'amplifyconfiguration.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await _configureAmplify();

  runApp(const FirstAmplifyApp());
}

Future<void> _configureAmplify() async {
  try {
    final authPlugin = AmplifyAuthCognito();
    await Amplify.addPlugin(authPlugin);

    await Amplify.configure(amplifyconfig);
  } on Exception catch (e) {
    safePrint('An error occurred while configuring Amplify: $e');
  }
}

class FirstAmplifyApp extends StatelessWidget {
  const FirstAmplifyApp({Key? key}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return Authenticator(
      child: MaterialApp(
        builder: Authenticator.builder(),
        title: 'Amplify Dart First Authentication Demo',
        home:
            const BuildOnPage(title: 'Amplify Dart First Authentication Demo'),
      ),
    );
  }
}

class BuildOnPage extends StatefulWidget {
  const BuildOnPage({Key? key, required this.title}) : super(key: key);

  final String title;

  @override
  State<BuildOnPage> createState() => _BuildOnPageState();
}

class _BuildOnPageState extends State<BuildOnPage> {
  // Returns a name to the current platform
  String get _osPlatform {
    if (kIsWeb) {
      return 'Web';
    } else if (Platform.isAndroid) {
      return 'Android';
    } else if (Platform.isIOS) {
      return 'iOS';
    } else if (Platform.isMacOS) {
      return 'macOS Desktop';
    } else if (Platform.isWindows) {
      return 'Windows Desktop';
    } else if (Platform.isLinux) {
      return 'Linux Desktop';
    } else {
      return 'Unknown';
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.title),
      ),
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: <Widget>[
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: FutureBuilder<AuthUser>(
                future: Amplify.Auth.getCurrentUser(),
                builder: (context, currentUserSnapshot) {
                  if (currentUserSnapshot.connectionState ==
                      ConnectionState.active) {
                    return const Text('Loading user');
                  } else {
                    return Text(
                      'Welcome to $_osPlatform ${currentUserSnapshot.data?.username}',
                    );
                  }
                },
              ),
            ),
            const SignOutButton(),
          ],
        ),
      ),
    );
  }
}
