require 'xcodeproj'
project = Xcodeproj::Project.new(File.join(__dir__, 'Nivli.xcodeproj'))
app = project.new_target(:application, 'Nivli', :ios, '26.0')
ui = project.new_target(:ui_test_bundle, 'NivliUITests', :ios, '26.0')
ui.add_dependency(app)
Dir.glob(File.join(__dir__, '{Nivli,Sources/NivliCore}/*.swift')).sort.each { |path| app.add_file_references([project.main_group.new_file(path.sub(__dir__ + '/', ''))]) }
Dir.glob(File.join(__dir__, 'UITests/*.swift')).each { |path| ui.add_file_references([project.main_group.new_file(path.sub(__dir__ + '/', ''))]) }
[app, ui].each do |target|
 target.build_configurations.each do |config|
  config.build_settings.merge!({'SWIFT_VERSION'=>'6.0','GENERATE_INFOPLIST_FILE'=>'YES','PRODUCT_BUNDLE_IDENTIFIER'=>"app.nivli.#{target.name}",'TARGETED_DEVICE_FAMILY'=>'1','IPHONEOS_DEPLOYMENT_TARGET'=>'26.0'})
 end
end
app.frameworks_build_phase.add_file_reference(project.main_group.new_file('usr/lib/libsqlite3.tbd', :sdk_root))
app.build_configurations.each { |c| c.build_settings['CODE_SIGN_ENTITLEMENTS'] = 'Nivli/Nivli.entitlements'; c.build_settings['INFOPLIST_KEY_NSCameraUsageDescription'] = '扫描一次性配对二维码。你也可以手动输入，无需摄像头。'; c.build_settings['INFOPLIST_KEY_UILaunchScreen_Generation'] = 'YES' }
ui.build_configurations.each { |c| c.build_settings['TEST_TARGET_NAME'] = 'Nivli' }
fixture = File.join(__dir__, "UITests/LiveFixture.json")
ui.resources_build_phase.add_file_reference(project.main_group.new_file("UITests/LiveFixture.json")) if File.exist?(fixture)
project.save
scheme = Xcodeproj::XCScheme.new
scheme.add_build_target(app)
scheme.add_test_target(ui)
scheme.set_launch_target(app)
scheme.save_as(project.path, 'Nivli', true)
