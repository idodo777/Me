THEOS_PACKAGE_SCHEME = rootless
ARCHS = arm64 arm64e
TARGET := iphone:clang:latest:15.0

include $(THEOS)/makefiles/common.mk

TWEAK_NAME = ZFBpay

ZFBpay_FILES = Tweak.m ZFBHelpers.m ZFBFloatBar.m ZFBSettings.m
ZFBpay_FRAMEWORKS = UIKit Foundation QuartzCore
ZFBpay_LIBRARIES = substrate
# ARC 显式开启（源码按 ARC 编写）；-fno-modules 与手册 §10 一致；
# -Wno-deprecated-declarations 容纳 [UIApplication windows] 回退路径。
ZFBpay_CFLAGS += -fobjc-arc -fno-modules -fno-implicit-modules -Wno-deprecated-declarations

include $(THEOS)/makefiles/tweak.mk
